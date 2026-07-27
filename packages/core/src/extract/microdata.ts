/**
 * Microdata / RDFa — `itemprop="price"` and friends. Second in the chain: less
 * common than JSON-LD but still emitted by a fair number of older storefronts.
 *
 * Queries are scoped to a Product/Offer itemscope first, because a bare
 * `[itemprop=price]` sweep across a whole page happily picks up the "related
 * products" carousel. Only if the scoped pass finds nothing do we widen.
 */

import { parseAvailability } from "./availability";
import { parsePrice } from "./price";
import type { CheerioElement, CheerioSelection, PriceCandidate, StrategyContext } from "./types";

const SCOPE_SELECTOR = '[itemtype*="Product"], [itemtype*="Offer"], [typeof*="Product"]';
const PRICE_SELECTOR = [
  '[itemprop="price"]',
  '[itemprop="lowPrice"]',
  '[property="price"]',
  '[property="schema:price"]',
].join(", ");
const CURRENCY_SELECTOR = '[itemprop="priceCurrency"], [property="priceCurrency"]';
const AVAILABILITY_SELECTOR = '[itemprop="availability"], [property="availability"]';
const NAME_SELECTOR = '[itemprop="name"], [property="name"]';
const IMAGE_SELECTOR = '[itemprop="image"], [property="image"]';

/**
 * Microdata puts its machine-readable value in `content` (or `value` on an
 * input, `href` on a link) and its human-readable one in the text node.
 */
function readValue($: StrategyContext["$"], element: CheerioElement): string | undefined {
  const node = $(element);
  const candidates = [
    node.attr("content"),
    node.attr("value"),
    node.attr("href"),
    node.attr("src"),
    node.text(),
  ];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed && trimmed.length > 0) {
      return trimmed;
    }
  }
}

function firstValue(
  $: StrategyContext["$"],
  root: CheerioSelection,
  selector: string
): string | undefined {
  for (const element of root.find(selector).addBack(selector).toArray()) {
    const value = readValue($, element);
    if (value) {
      return value;
    }
  }
}

function candidateFromScope(
  { $, locale }: StrategyContext,
  root: CheerioSelection
): PriceCandidate | null {
  const rawPrice = firstValue($, root, PRICE_SELECTOR);
  if (!rawPrice) {
    return null;
  }
  const parsed = parsePrice(rawPrice, {
    currency: firstValue($, root, CURRENCY_SELECTOR),
    locale,
  });
  if (!parsed) {
    return null;
  }

  const candidate: PriceCandidate = { price: parsed.amount };
  if (parsed.currency) {
    candidate.currency = parsed.currency;
  }

  const availability = parseAvailability(firstValue($, root, AVAILABILITY_SELECTOR));
  if (availability) {
    candidate.availability = availability.availability;
    if (availability.inStock !== undefined) {
      candidate.inStock = availability.inStock;
    }
  }

  const title = firstValue($, root, NAME_SELECTOR);
  if (title) {
    candidate.title = title;
  }
  const imageUrl = firstValue($, root, IMAGE_SELECTOR);
  if (imageUrl) {
    candidate.imageUrl = imageUrl;
  }
  return candidate;
}

export function extractMicrodata(context: StrategyContext): PriceCandidate | null {
  const { $ } = context;

  for (const scope of $(SCOPE_SELECTOR).toArray()) {
    const candidate = candidateFromScope(context, $(scope));
    if (candidate) {
      return candidate;
    }
  }
  return candidateFromScope(context, $.root());
}
