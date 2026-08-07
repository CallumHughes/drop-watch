/**
 * schema.org/Product JSON-LD — the first and by far the highest-yield link in
 * the chain. Most ecommerce platforms emit it, which is what makes "track any
 * product" work with zero per-site configuration.
 *
 * Handles `@graph` wrappers, several `<script>` blocks on one page, arrays at
 * the top level, and Products nested inside a WebPage's `mainEntity`.
 */

import { parseAvailability } from "./availability";
import { parsePrice } from "./price";
import type { PriceCandidate, StrategyContext } from "./types";

/** Depth cap on the JSON walk — real documents nest a handful of levels. */
const MAX_WALK_DEPTH = 12;
/** Node cap, so a pathological document cannot pin the event loop. */
const MAX_NODES = 2000;

const CDATA_WRAPPER = /^\s*(?:\/\*\s*)?<!\[CDATA\[|\]\]>(?:\s*\*\/)?\s*$/g;
const HTML_COMMENT = /^\s*<!--|-->\s*$/g;

type JsonRecord = Record<string, unknown>;
type CandidateFields = Omit<PriceCandidate, "confidence" | "evidence">;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function typeNames(node: JsonRecord): string[] {
  return asArray(node["@type"])
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.split("/").at(-1)?.toLowerCase() ?? "");
}

/** Depth-first walk collecting every object in the document, `@graph` included. */
function collectNodes(value: unknown, out: JsonRecord[], depth: number): void {
  if (depth > MAX_WALK_DEPTH || out.length >= MAX_NODES) {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectNodes(entry, out, depth + 1);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  out.push(value);
  for (const entry of Object.values(value)) {
    collectNodes(entry, out, depth + 1);
  }
}

function parseScript(raw: string): unknown {
  const cleaned = raw.replace(CDATA_WRAPPER, "").replace(HTML_COMMENT, "").trim();
  if (cleaned.length === 0) {
    return null;
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function firstString(value: unknown): string | undefined {
  for (const entry of asArray(value)) {
    if (typeof entry === "string" && entry.trim().length > 0) {
      return entry.trim();
    }
    if (isRecord(entry)) {
      const nested = entry.url ?? entry.contentUrl ?? entry.name ?? entry["@id"];
      if (typeof nested === "string" && nested.trim().length > 0) {
        return nested.trim();
      }
    }
  }
}

/** Offers may be a single object, an array, or an AggregateOffer wrapping more. */
function offerCandidates(node: JsonRecord): JsonRecord[] {
  const offers: JsonRecord[] = [];
  for (const offer of asArray(node.offers)) {
    if (!isRecord(offer)) {
      continue;
    }
    offers.push(offer);
    for (const nested of asArray(offer.offers)) {
      if (isRecord(nested)) {
        offers.push(nested);
      }
    }
  }
  return offers;
}

function priceFrom(offer: JsonRecord): string | number | undefined {
  const direct = offer.price ?? offer.lowPrice ?? offer.highPrice;
  if (typeof direct === "string" || typeof direct === "number") {
    return direct;
  }
  for (const spec of asArray(offer.priceSpecification)) {
    if (isRecord(spec)) {
      const specPrice = spec.price;
      if (typeof specPrice === "string" || typeof specPrice === "number") {
        return specPrice;
      }
    }
  }
}

function currencyFrom(offer: JsonRecord): string | undefined {
  const direct = offer.priceCurrency;
  if (typeof direct === "string") {
    return direct;
  }
  for (const spec of asArray(offer.priceSpecification)) {
    if (isRecord(spec) && typeof spec.priceCurrency === "string") {
      return spec.priceCurrency;
    }
  }
}

function candidateFromOffer(
  product: JsonRecord,
  offer: JsonRecord,
  locale: string | undefined
): CandidateFields | null {
  const rawPrice = priceFrom(offer);
  if (rawPrice === undefined) {
    return null;
  }
  const parsed = parsePrice(rawPrice, { currency: currencyFrom(offer), locale });
  if (!parsed) {
    return null;
  }

  const availability = parseAvailability(
    firstString(offer.availability) ?? firstString(offer.itemAvailability)
  );
  const candidate: CandidateFields = { price: parsed.amount };
  if (parsed.currency) {
    candidate.currency = parsed.currency;
  }
  if (availability) {
    candidate.availability = availability.availability;
    if (availability.inStock !== undefined) {
      candidate.inStock = availability.inStock;
    }
  }
  const title = firstString(product.name);
  if (title) {
    candidate.title = title;
  }
  const imageUrl = firstString(product.image);
  if (imageUrl) {
    candidate.imageUrl = imageUrl;
  }
  return candidate;
}

/** Products first; anything else carrying an `offers` block is the fallback. */
function rankNodes(nodes: JsonRecord[]): JsonRecord[] {
  const products: JsonRecord[] = [];
  const others: JsonRecord[] = [];
  for (const node of nodes) {
    if (node.offers === undefined) {
      continue;
    }
    if (typeNames(node).some((name) => name.includes("product"))) {
      products.push(node);
    } else {
      others.push(node);
    }
  }
  return [...products, ...others];
}

function skuFrom(value: unknown): string | undefined {
  if (typeof value === "string") {
    const sku = value.trim();
    return sku.length > 0 ? sku : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
}

interface SelectedSkuHint {
  conflict: boolean;
  sku?: string;
}

/** A SKU hint is trustworthy only when every selected control points to one SKU. */
function selectedSkuHint($: StrategyContext["$"]): SelectedSkuHint {
  const skus = new Set<string>();
  for (const element of $('[data-sku-selected="true"][data-sku]').toArray()) {
    const sku = skuFrom($(element).attr("data-sku"));
    if (sku) {
      skus.add(sku);
    }
  }
  if (skus.size === 1) {
    return { conflict: false, sku: skus.values().next().value };
  }
  return { conflict: skus.size > 1 };
}

interface UrlIdentity {
  full: string;
  hasQuery: boolean;
  originPathname: string;
}

/** Hashes do not identify variants; sorted query parameters still do. */
function urlIdentity(value: unknown): UrlIdentity | undefined {
  if (typeof value !== "string") {
    return;
  }
  try {
    const url = new URL(value);
    url.hash = "";
    url.searchParams.sort();
    const originPathname = `${url.origin}${url.pathname}`;
    return {
      full: `${originPathname}${url.search}`,
      hasQuery: url.search.length > 0,
      originPathname,
    };
  } catch {
    // Only absolute, well-formed URLs have an origin to compare.
  }
}

type UrlMatch = "exact" | "origin-pathname" | null;

function pageUrlMatch(
  product: JsonRecord,
  offer: JsonRecord,
  pageUrl: UrlIdentity | undefined
): UrlMatch {
  if (!pageUrl) {
    return null;
  }

  let originPathnameMatches = false;
  for (const value of [product.url, offer.url]) {
    const candidateUrl = urlIdentity(value);
    if (candidateUrl?.full === pageUrl.full) {
      return "exact";
    }
    if (candidateUrl?.originPathname === pageUrl.originPathname) {
      originPathnameMatches = true;
    }
  }
  return originPathnameMatches ? "origin-pathname" : null;
}

interface OfferWithProduct {
  isProduct: boolean;
  offer: JsonRecord;
  product: JsonRecord;
  selectedSkuMatch: boolean;
  urlMatch: UrlMatch;
}

/**
 * Ranking is global because a selected variant can live after an earlier Product
 * node. Each bucket preserves the existing product-first/document order.
 */
function rankOffers(
  nodes: JsonRecord[],
  selected: string | undefined,
  pageUrl: UrlIdentity | undefined
): OfferWithProduct[] {
  const selectedSkuMatches: OfferWithProduct[] = [];
  const exactUrlMatches: OfferWithProduct[] = [];
  const originPathnameMatches: OfferWithProduct[] = [];
  const remaining: OfferWithProduct[] = [];
  const seenOffers = new Set<JsonRecord>();

  for (const product of rankNodes(nodes)) {
    for (const offer of offerCandidates(product)) {
      if (seenOffers.has(offer)) {
        continue;
      }
      seenOffers.add(offer);
      const offerSku = skuFrom(offer.sku);
      const selectedSkuMatchesOffer =
        selected !== undefined &&
        (offerSku === selected || (offerSku === undefined && skuFrom(product.sku) === selected));
      const urlMatch = pageUrlMatch(product, offer, pageUrl);
      const candidate: OfferWithProduct = {
        isProduct: typeNames(product).includes("product"),
        offer,
        product,
        selectedSkuMatch: selectedSkuMatchesOffer,
        urlMatch,
      };
      if (selectedSkuMatchesOffer) {
        selectedSkuMatches.push(candidate);
      } else if (urlMatch === "exact") {
        exactUrlMatches.push(candidate);
      } else if (urlMatch === "origin-pathname") {
        originPathnameMatches.push(candidate);
      } else {
        remaining.push(candidate);
      }
    }
  }
  return [...selectedSkuMatches, ...exactUrlMatches, ...originPathnameMatches, ...remaining];
}

interface PricedOffer extends OfferWithProduct {
  candidate: CandidateFields;
}

function isAggregateOrRange(offer: JsonRecord): boolean {
  return (
    typeNames(offer).includes("aggregateoffer") ||
    offer.lowPrice !== undefined ||
    offer.highPrice !== undefined
  );
}

function confidenceForJsonLd(
  winning: PricedOffer,
  candidates: PricedOffer[],
  hint: SelectedSkuHint,
  pageUrl: UrlIdentity | undefined
): Pick<PriceCandidate, "confidence" | "evidence"> {
  const candidateCount = candidates.length;
  const selectedMatches = candidates.filter((candidate) => candidate.selectedSkuMatch);
  const exactUrlMatches = candidates.filter((candidate) => candidate.urlMatch === "exact");
  const selectedUrlConflict =
    hint.sku !== undefined &&
    (selectedMatches.length === 0 ||
      (exactUrlMatches.length > 0 &&
        !exactUrlMatches.some((candidate) => candidate.selectedSkuMatch)));

  if (hint.conflict || selectedUrlConflict) {
    return { confidence: "low", evidence: { candidateCount, type: "jsonld:conflict" } };
  }
  if (!winning.isProduct) {
    return { confidence: "low", evidence: { candidateCount, type: "jsonld:non-product" } };
  }
  if (isAggregateOrRange(winning.offer)) {
    return { confidence: "low", evidence: { candidateCount, type: "jsonld:aggregate-offer" } };
  }
  if (winning.selectedSkuMatch) {
    if (selectedMatches.length === 1) {
      return { confidence: "high", evidence: { candidateCount, type: "jsonld:selected-sku" } };
    }
    return { confidence: "low", evidence: { candidateCount, type: "jsonld:multiple-candidates" } };
  }
  if (winning.urlMatch === "exact") {
    if (exactUrlMatches.length === 1) {
      return { confidence: "high", evidence: { candidateCount, type: "jsonld:exact-url" } };
    }
    return { confidence: "low", evidence: { candidateCount, type: "jsonld:multiple-candidates" } };
  }
  if (winning.urlMatch === "origin-pathname") {
    return { confidence: "low", evidence: { candidateCount, type: "jsonld:pathname" } };
  }
  if (candidateCount > 1) {
    return { confidence: "low", evidence: { candidateCount, type: "jsonld:multiple-candidates" } };
  }
  if (pageUrl?.hasQuery) {
    return { confidence: "low", evidence: { candidateCount, type: "jsonld:queried-url" } };
  }
  if (pageUrl) {
    return { confidence: "high", evidence: { candidateCount, type: "jsonld:singleton" } };
  }
  return { confidence: "low", evidence: { candidateCount, type: "jsonld:document-order" } };
}

export function extractJsonLd({ $, locale, url }: StrategyContext): PriceCandidate | null {
  const nodes: JsonRecord[] = [];
  for (const element of $('script[type="application/ld+json"]').toArray()) {
    const parsed = parseScript($(element).text());
    if (parsed !== null) {
      collectNodes(parsed, nodes, 0);
    }
  }

  const currentPageUrl = urlIdentity(url);
  const hint = selectedSkuHint($);
  const candidates: PricedOffer[] = [];
  for (const rankedOffer of rankOffers(nodes, hint.sku, currentPageUrl)) {
    const candidate = candidateFromOffer(rankedOffer.product, rankedOffer.offer, locale);
    if (candidate) {
      candidates.push({ ...rankedOffer, candidate });
    }
  }
  const [winning] = candidates;
  if (!winning) {
    return null;
  }
  return {
    ...winning.candidate,
    ...confidenceForJsonLd(winning, candidates, hint, currentPageUrl),
  };
}
