/**
 * schema.org/Product JSON-LD — the first and by far the highest-yield link in
 * the chain. Most ecommerce platforms emit it, which is what makes "track any
 * product" work with zero per-site configuration.
 *
 * Handles `@graph` wrappers, several `<script>` blocks on one page, arrays at
 * the top level, and Products nested inside a WebPage's `mainEntity`.
 */

import { parseAvailability } from "./availability";
import { asArray, isRecord, type JsonRecord, MAX_NODES, MAX_WALK_DEPTH, parseScript } from "./json";
import {
  normalizeQueryValue,
  normalizeUrlParameterValue,
  type UrlIdentity,
  urlIdentity,
} from "./page-url";
import { parsePrice } from "./price";
import type { PriceCandidate, StrategyContext } from "./types";

type CandidateFields = Omit<PriceCandidate, "confidence" | "evidence">;

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

/**
 * The one selection convention we trust: `data-sku` naming the variant and
 * `data-sku-selected="true"` marking the chosen one, as the John Lewis size and
 * colour pickers emit. Deliberately narrow — a looser reading (`aria-checked`,
 * a `selected` class) matches carousels and filter chips too, and a wrong SKU
 * hint is worse than none because it wins the ranking outright.
 *
 * The hint is trustworthy only when every selected control points to one SKU.
 */
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
    const absoluteCandidateUrl = urlIdentity(value);
    const candidateUrl = absoluteCandidateUrl ?? urlIdentity(value, pageUrl.baseUrl);
    if (candidateUrl?.full === pageUrl.full) {
      return "exact";
    }
    if (absoluteCandidateUrl?.originPathname === pageUrl.originPathname) {
      originPathnameMatches = true;
    }
  }
  return originPathnameMatches ? "origin-pathname" : null;
}

/**
 * Generic schema.org properties that commonly appear as variant query keys.
 * Values are canonical property names so aliases never leak into evidence.
 */
const VARIANT_PARAMETER_PROPERTIES = new Map([
  ["color", "color"],
  ["colour", "color"],
  ["material", "material"],
  ["model", "model"],
  ["mpn", "mpn"],
  ["pattern", "pattern"],
  ["size", "size"],
  ["sku", "sku"],
]);
const VARIANT_PROPERTIES = new Set(VARIANT_PARAMETER_PROPERTIES.values());
const VALUE_KEYS = ["value", "name"] as const;

function normalizedVariantValue(value: string | number, property: string): string {
  const normalized =
    property === "size"
      ? normalizeUrlParameterValue(String(value))
      : normalizeQueryValue(String(value));
  return normalized;
}

function appendVariantValues(value: unknown, property: string, out: string[]): void {
  if (typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) {
    const normalized = normalizedVariantValue(value, property);
    if (normalized.length > 0) {
      out.push(normalized);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      appendVariantValues(entry, property, out);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const key of VALUE_KEYS) {
    if (key in value) {
      appendVariantValues(value[key], property, out);
    }
  }
}

function variantValues(product: JsonRecord, property: string): string[] {
  const values: string[] = [];
  appendVariantValues(product[property], property, values);
  return [...new Set(values)];
}

interface SelectableVariantValues {
  ambiguous: boolean;
  values: string[];
}

function isSplitAliasArray(value: unknown[]): boolean {
  if (value.length !== VALUE_KEYS.length) {
    return false;
  }
  const seenKeys = new Set<(typeof VALUE_KEYS)[number]>();
  for (const entry of value) {
    if (!isRecord(entry)) {
      return false;
    }
    const entryKeys = VALUE_KEYS.filter((key) => key in entry);
    const [entryKey] = entryKeys;
    if (entryKeys.length !== 1 || !entryKey || seenKeys.has(entryKey)) {
      return false;
    }
    seenKeys.add(entryKey);
  }
  return seenKeys.size === VALUE_KEYS.length;
}

function selectableValuesFrom(value: unknown, property: string): SelectableVariantValues {
  if (typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) {
    const normalized = normalizedVariantValue(value, property);
    return { ambiguous: false, values: normalized.length > 0 ? [normalized] : [] };
  }
  if (Array.isArray(value)) {
    const entries = value.map((entry) => selectableValuesFrom(entry, property));
    if (entries.some((entry) => entry.ambiguous)) {
      return { ambiguous: true, values: [] };
    }
    const values = [...new Set(entries.flatMap((entry) => entry.values))];
    const isOneEntry = entries.filter((entry) => entry.values.length > 0).length <= 1;
    const ambiguous = values.length > 1 && !(isOneEntry || isSplitAliasArray(value));
    return { ambiguous, values: ambiguous ? [] : values };
  }
  if (!isRecord(value)) {
    return { ambiguous: false, values: [] };
  }
  const entries = VALUE_KEYS.filter((key) => key in value).map((key) =>
    selectableValuesFrom(value[key], property)
  );
  if (entries.some((entry) => entry.ambiguous)) {
    return { ambiguous: true, values: [] };
  }
  return {
    ambiguous: false,
    values: [...new Set(entries.flatMap((entry) => entry.values))],
  };
}

function selectableVariantValues(product: JsonRecord, property: string): string[] {
  const result = selectableValuesFrom(product[property], property);
  return result.ambiguous ? [] : result.values;
}

function queryValuesByProperty(pageUrl: UrlIdentity): Map<string, string[]> | null {
  for (const parameter of pageUrl.ambiguousParameters) {
    if (VARIANT_PARAMETER_PROPERTIES.has(parameter)) {
      return null;
    }
  }
  const values = new Map<string, string[]>();
  for (const [parameter, value] of pageUrl.parameters) {
    const property = VARIANT_PARAMETER_PROPERTIES.get(parameter);
    if (!property) {
      continue;
    }
    const propertyValues = values.get(property) ?? [];
    const normalizedValue = normalizedVariantValue(value, property);
    if (propertyValues.length > 0) {
      const equivalent = propertyValues.some(
        (previous) => normalizedVariantValue(previous, property) === normalizedValue
      );
      if (!equivalent) {
        return null;
      }
    } else {
      propertyValues.push(value);
    }
    values.set(property, propertyValues);
  }
  return values;
}

interface VariantParameterResult {
  conflict: boolean;
  matches: string[];
}

function variantParameterResult(
  product: JsonRecord,
  pageUrl: UrlIdentity | undefined
): VariantParameterResult {
  if (!pageUrl) {
    return { conflict: false, matches: [] };
  }
  const queryValues = queryValuesByProperty(pageUrl);
  if (!queryValues || queryValues.size === 0) {
    return { conflict: false, matches: [] };
  }
  const matches: string[] = [];
  for (const [property, values] of queryValues) {
    const productValues = selectableVariantValues(product, property);
    if (productValues.length === 0) {
      return { conflict: false, matches: [] };
    }
    const propertyMatches = values.every((value) =>
      productValues.includes(normalizedVariantValue(value, property))
    );
    if (!propertyMatches) {
      return { conflict: true, matches: [] };
    }
    matches.push(property);
  }
  return { conflict: false, matches };
}

function comparableVariantProperties(product: JsonRecord): ReadonlySet<string> {
  const properties = new Set<string>();
  for (const property of VARIANT_PROPERTIES) {
    if (variantValues(product, property).length > 0) {
      properties.add(property);
    }
  }
  return properties;
}

function schemaPropertyName(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return;
  }
  const name = value.split("/").at(-1)?.trim().toLowerCase();
  return name && name.length > 0 ? name : undefined;
}

interface VariantContext {
  group: JsonRecord;
  variesBy: ReadonlySet<string>;
}

function nodeId(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value["@id"] !== "string") {
    return;
  }
  const id = value["@id"].trim();
  return id.length > 0 ? id : undefined;
}

function nodeReference(
  value: unknown,
  nodesByIdMap: ReadonlyMap<string, JsonRecord>
): JsonRecord | undefined {
  if (typeof value === "string") {
    return nodesByIdMap.get(value);
  }
  if (!isRecord(value)) {
    return;
  }
  const id = nodeId(value);
  if (id && Object.keys(value).every((key) => key.startsWith("@"))) {
    return nodesByIdMap.get(id) ?? value;
  }
  return value;
}

function indexNodesById(nodes: JsonRecord[]): Map<string, JsonRecord> {
  const indexedNodes = new Map<string, JsonRecord>();
  for (const node of nodes) {
    const id = nodeId(node);
    if (id) {
      indexedNodes.set(id, node);
    }
  }
  return indexedNodes;
}

function groupVariantContext(group: JsonRecord): VariantContext {
  const variesBy = new Set<string>();
  for (const value of asArray(group.variesBy)) {
    const property = schemaPropertyName(value);
    if (property) {
      variesBy.add(property);
    }
  }
  return { group, variesBy };
}

function attachGroupContext(
  group: JsonRecord,
  context: VariantContext,
  nodesByIdMap: ReadonlyMap<string, JsonRecord>,
  contexts: WeakMap<JsonRecord, VariantContext>,
  contextsById: Map<string, VariantContext>
): void {
  const groupId = nodeId(group);
  if (groupId) {
    contextsById.set(groupId, context);
  }
  for (const variant of asArray(group.hasVariant)) {
    const resolved = nodeReference(variant, nodesByIdMap);
    if (resolved) {
      contexts.set(resolved, context);
    }
    const id = nodeId(variant);
    if (id) {
      contextsById.set(id, context);
    }
  }
}

function attachNodeContext(
  node: JsonRecord,
  nodesByIdMap: ReadonlyMap<string, JsonRecord>,
  contexts: WeakMap<JsonRecord, VariantContext>,
  contextsById: ReadonlyMap<string, VariantContext>
): void {
  const id = nodeId(node);
  const directContext = id ? contextsById.get(id) : undefined;
  if (directContext) {
    contexts.set(node, directContext);
  }
  const group = nodeReference(node.isVariantOf, nodesByIdMap);
  if (group && typeNames(group).includes("productgroup")) {
    const groupContext = contextsById.get(nodeId(group) ?? "");
    if (groupContext) {
      contexts.set(node, groupContext);
    }
  }
}

function variantContexts(nodes: JsonRecord[]): WeakMap<JsonRecord, VariantContext> {
  const contexts = new WeakMap<JsonRecord, VariantContext>();
  const nodesByIdMap = indexNodesById(nodes);
  const contextsById = new Map<string, VariantContext>();
  for (const group of nodes) {
    if (typeNames(group).includes("productgroup")) {
      attachGroupContext(group, groupVariantContext(group), nodesByIdMap, contexts, contextsById);
    }
  }
  for (const node of nodes) {
    attachNodeContext(node, nodesByIdMap, contexts, contextsById);
  }
  return contexts;
}

function semanticEvidenceIsTrusted(
  pageUrl: UrlIdentity | undefined,
  matchedParams: string[],
  context: VariantContext | undefined
): boolean {
  if (!pageUrl || matchedParams.length === 0) {
    return false;
  }
  const hasUnknownParameter = [...pageUrl.parameters.keys(), ...pageUrl.ambiguousParameters].some(
    (parameter) => !VARIANT_PARAMETER_PROPERTIES.has(parameter)
  );
  if (!context) {
    return !hasUnknownParameter;
  }
  for (const property of context.variesBy) {
    if (!(VARIANT_PROPERTIES.has(property) && matchedParams.includes(property))) {
      return false;
    }
  }
  return !hasUnknownParameter || context.variesBy.size > 0;
}

interface OfferWithProduct {
  comparableVariantProperties: ReadonlySet<string>;
  isProduct: boolean;
  offer: JsonRecord;
  product: JsonRecord;
  selectedSkuMatch: boolean;
  urlMatch: UrlMatch;
  variantContext?: VariantContext;
  variantParameterConflict: boolean;
  variantParameterMatches: string[];
  variantParametersTrusted: boolean;
}

interface OfferBuckets {
  conflictingExactUrlMatches: OfferWithProduct[];
  exactUrlMatches: OfferWithProduct[];
  originPathnameMatches: OfferWithProduct[];
  remaining: OfferWithProduct[];
  selectedSkuMatches: OfferWithProduct[];
  variantParameterMatches: OfferWithProduct[];
}

function addToOfferBucket(candidate: OfferWithProduct, buckets: OfferBuckets): void {
  if (candidate.selectedSkuMatch) {
    buckets.selectedSkuMatches.push(candidate);
  } else if (candidate.urlMatch === "exact" && !candidate.variantParameterConflict) {
    buckets.exactUrlMatches.push(candidate);
  } else if (candidate.variantParameterMatches.length > 0) {
    buckets.variantParameterMatches.push(candidate);
  } else if (candidate.urlMatch === "exact") {
    buckets.conflictingExactUrlMatches.push(candidate);
  } else if (candidate.urlMatch === "origin-pathname") {
    buckets.originPathnameMatches.push(candidate);
  } else {
    buckets.remaining.push(candidate);
  }
}

function offerWithProduct(
  product: JsonRecord,
  offer: JsonRecord,
  selected: string | undefined,
  pageUrl: UrlIdentity | undefined,
  contexts: WeakMap<JsonRecord, VariantContext>
): OfferWithProduct {
  const offerSku = skuFrom(offer.sku);
  const selectedSkuMatch =
    selected !== undefined &&
    (offerSku === selected || (offerSku === undefined && skuFrom(product.sku) === selected));
  const urlMatch = pageUrlMatch(product, offer, pageUrl);
  const variantParameters = variantParameterResult(product, pageUrl);
  return {
    comparableVariantProperties: comparableVariantProperties(product),
    isProduct: typeNames(product).includes("product"),
    offer,
    product,
    selectedSkuMatch,
    urlMatch,
    variantContext: contexts.get(product),
    variantParameterConflict: variantParameters.conflict,
    variantParameterMatches: variantParameters.matches,
    variantParametersTrusted: semanticEvidenceIsTrusted(
      pageUrl,
      variantParameters.matches,
      contexts.get(product)
    ),
  };
}

function hasTrustedVariantConflict(
  candidate: OfferWithProduct,
  candidates: OfferWithProduct[]
): boolean {
  const context = candidate.variantContext;
  return (
    candidate.variantParameterConflict &&
    context !== undefined &&
    candidates.some(
      (other) =>
        other !== candidate &&
        other.variantContext?.group === context.group &&
        other.variantParameterMatches.length > 0
    )
  );
}

/**
 * Ranking is global because a selected variant can live after an earlier Product
 * node. Each bucket preserves the existing product-first/document order.
 */
function rankOffers(
  nodes: JsonRecord[],
  selected: string | undefined,
  pageUrl: UrlIdentity | undefined,
  contexts: WeakMap<JsonRecord, VariantContext>
): OfferWithProduct[] {
  const buckets: OfferBuckets = {
    conflictingExactUrlMatches: [],
    exactUrlMatches: [],
    originPathnameMatches: [],
    remaining: [],
    selectedSkuMatches: [],
    variantParameterMatches: [],
  };
  const seenOffers = new Set<JsonRecord>();
  const candidates: OfferWithProduct[] = [];

  for (const product of rankNodes(nodes)) {
    for (const offer of offerCandidates(product)) {
      if (seenOffers.has(offer)) {
        continue;
      }
      seenOffers.add(offer);
      candidates.push(offerWithProduct(product, offer, selected, pageUrl, contexts));
    }
  }
  for (const candidate of candidates) {
    addToOfferBucket(
      {
        ...candidate,
        variantParameterConflict: hasTrustedVariantConflict(candidate, candidates),
      },
      buckets
    );
  }
  return [
    ...buckets.selectedSkuMatches,
    ...buckets.exactUrlMatches,
    ...buckets.variantParameterMatches,
    ...buckets.conflictingExactUrlMatches,
    ...buckets.originPathnameMatches,
    ...buckets.remaining,
  ];
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

function hasSelectedUrlConflict(
  hint: SelectedSkuHint,
  selectedMatches: PricedOffer[],
  exactUrlMatches: PricedOffer[]
): boolean {
  return (
    hint.sku !== undefined &&
    (selectedMatches.length === 0 ||
      (exactUrlMatches.length > 0 &&
        !exactUrlMatches.some((candidate) => candidate.selectedSkuMatch)))
  );
}

function hasSelectedVariantConflict(
  hint: SelectedSkuHint,
  selectedMatches: PricedOffer[],
  variantParameterMatches: PricedOffer[]
): boolean {
  if (variantParameterMatches.length === 0) {
    return false;
  }
  const selectedConflict =
    hint.sku !== undefined &&
    selectedMatches.length > 0 &&
    !variantParameterMatches.some((candidate) => candidate.selectedSkuMatch);
  return selectedConflict;
}

function uniqueMatchConfidence(
  candidateCount: number,
  matchCount: number,
  type: "jsonld:selected-sku" | "jsonld:exact-url"
): Pick<PriceCandidate, "confidence" | "evidence"> {
  return matchCount === 1
    ? { confidence: "high", evidence: { candidateCount, type } }
    : { confidence: "low", evidence: { candidateCount, type: "jsonld:multiple-candidates" } };
}

function semanticCandidatesAreComparable(winning: PricedOffer, candidates: PricedOffer[]): boolean {
  const relevant = winning.variantContext
    ? candidates.filter(
        (candidate) =>
          candidate.isProduct && candidate.variantContext?.group === winning.variantContext?.group
      )
    : candidates.filter((candidate) => candidate.isProduct);
  return relevant.every((candidate) =>
    winning.variantParameterMatches.every((property) =>
      candidate.comparableVariantProperties.has(property)
    )
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
  const variantParameterMatches = candidates.filter(
    (candidate) => candidate.variantParameterMatches.length > 0
  );
  if (
    hint.conflict ||
    hasSelectedUrlConflict(hint, selectedMatches, exactUrlMatches) ||
    hasSelectedVariantConflict(hint, selectedMatches, variantParameterMatches)
  ) {
    return { confidence: "low", evidence: { candidateCount, type: "jsonld:conflict" } };
  }
  if (!winning.isProduct) {
    return { confidence: "low", evidence: { candidateCount, type: "jsonld:non-product" } };
  }
  if (isAggregateOrRange(winning.offer)) {
    return { confidence: "low", evidence: { candidateCount, type: "jsonld:aggregate-offer" } };
  }
  if (winning.variantParameterConflict) {
    return { confidence: "low", evidence: { candidateCount, type: "jsonld:conflict" } };
  }
  if (winning.selectedSkuMatch) {
    return uniqueMatchConfidence(candidateCount, selectedMatches.length, "jsonld:selected-sku");
  }
  if (winning.urlMatch === "exact") {
    return uniqueMatchConfidence(candidateCount, exactUrlMatches.length, "jsonld:exact-url");
  }
  if (winning.variantParameterMatches.length > 0) {
    if (variantParameterMatches.length === 1) {
      return {
        confidence:
          winning.variantParametersTrusted && semanticCandidatesAreComparable(winning, candidates)
            ? "high"
            : "low",
        evidence: {
          candidateCount,
          matchedParams: winning.variantParameterMatches,
          type: "jsonld:variant-params",
        },
      };
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
  const contexts = variantContexts(nodes);
  const hint = selectedSkuHint($);
  const candidates: PricedOffer[] = [];
  for (const rankedOffer of rankOffers(nodes, hint.sku, currentPageUrl, contexts)) {
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
