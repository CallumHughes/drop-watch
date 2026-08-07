/**
 * Microdata / RDFa — `itemprop="price"` and friends. Second in the chain: less
 * common than JSON-LD but still emitted by a fair number of older storefronts.
 *
 * Queries are scoped to a Product/Offer itemscope first, because a bare
 * `[itemprop=price]` sweep across a whole page happily picks up the "related
 * products" carousel. Only if the scoped pass finds nothing do we widen.
 */

import { parseAvailability } from "./availability";
import { urlIdentity } from "./page-url";
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

type CandidateFields = Omit<PriceCandidate, "confidence" | "evidence">;

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
): CandidateFields | null {
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

  const candidate: CandidateFields = { price: parsed.amount };
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

function priceCount({ $, locale }: StrategyContext, root: CheerioSelection): number {
  const currency = firstValue($, root, CURRENCY_SELECTOR);
  let count = 0;
  for (const element of root.find(PRICE_SELECTOR).addBack(PRICE_SELECTOR).toArray()) {
    const rawPrice = readValue($, element);
    if (rawPrice && parsePrice(rawPrice, { currency, locale })) {
      count += 1;
    }
  }
  return count;
}

export function extractMicrodata(context: StrategyContext): PriceCandidate | null {
  const { $, url } = context;
  const scopedCandidates: Array<{
    candidate: CandidateFields;
    isProduct: boolean;
    priceCount: number;
  }> = [];

  for (const scope of $(SCOPE_SELECTOR)
    .toArray()
    .filter((element) => $(element).parents(SCOPE_SELECTOR).length === 0)) {
    const candidate = candidateFromScope(context, $(scope));
    if (candidate) {
      const schemaType = `${$(scope).attr("itemtype") ?? ""} ${$(scope).attr("typeof") ?? ""}`;
      scopedCandidates.push({
        candidate,
        isProduct: schemaType.toLowerCase().includes("product"),
        priceCount: priceCount(context, $(scope)),
      });
    }
  }

  const [winning] = scopedCandidates;
  if (winning) {
    let candidateCount = 0;
    for (const scopedCandidate of scopedCandidates) {
      candidateCount += scopedCandidate.priceCount;
    }
    // A missing or malformed final URL cannot establish that there is no
    // unresolved variant query, so it stays `undefined` rather than `false`.
    const pageHasQuery = urlIdentity(url)?.hasQuery;
    if (candidateCount === 1 && winning.isProduct && pageHasQuery === false) {
      return {
        ...winning.candidate,
        confidence: "high",
        evidence: { candidateCount, type: "microdata:single-product-price" },
      };
    }
    return {
      ...winning.candidate,
      confidence: "low",
      evidence: {
        candidateCount,
        type:
          candidateCount === 1 && winning.isProduct && pageHasQuery
            ? "microdata:queried-url"
            : "microdata:ambiguous",
      },
    };
  }

  const documentCandidate = candidateFromScope(context, $.root());
  if (!documentCandidate) {
    return null;
  }
  return {
    ...documentCandidate,
    confidence: "low",
    evidence: { candidateCount: 1, type: "microdata:document-price" },
  };
}
