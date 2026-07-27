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

function candidateFromNode(node: JsonRecord, locale: string | undefined): PriceCandidate | null {
  for (const offer of offerCandidates(node)) {
    const rawPrice = priceFrom(offer);
    if (rawPrice === undefined) {
      continue;
    }
    const parsed = parsePrice(rawPrice, { currency: currencyFrom(offer), locale });
    if (!parsed) {
      continue;
    }

    const availability = parseAvailability(
      firstString(offer.availability) ?? firstString(offer.itemAvailability)
    );
    const candidate: PriceCandidate = { price: parsed.amount };
    if (parsed.currency) {
      candidate.currency = parsed.currency;
    }
    if (availability) {
      candidate.availability = availability.availability;
      if (availability.inStock !== undefined) {
        candidate.inStock = availability.inStock;
      }
    }
    const title = firstString(node.name);
    if (title) {
      candidate.title = title;
    }
    const imageUrl = firstString(node.image);
    if (imageUrl) {
      candidate.imageUrl = imageUrl;
    }
    return candidate;
  }
  return null;
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

export function extractJsonLd({ $, locale }: StrategyContext): PriceCandidate | null {
  const nodes: JsonRecord[] = [];
  for (const element of $('script[type="application/ld+json"]').toArray()) {
    const parsed = parseScript($(element).text());
    if (parsed !== null) {
      collectNodes(parsed, nodes, 0);
    }
  }

  for (const node of rankNodes(nodes)) {
    const candidate = candidateFromNode(node, locale);
    if (candidate) {
      return candidate;
    }
  }
  return null;
}
