/**
 * OpenGraph product tags — `product:price:amount` / `product:price:currency`.
 * Third in the chain. Facebook's older `og:price:*` spelling is accepted too,
 * and tags are read from both `property` and `name` attributes because plenty
 * of sites use the wrong one.
 */

import { parseAvailability } from "./availability";
import { parsePrice } from "./price";
import type { PriceCandidate, StrategyContext } from "./types";

const PRICE_TAGS = ["product:price:amount", "og:price:amount", "product:price"] as const;
const CURRENCY_TAGS = ["product:price:currency", "og:price:currency", "og:price:standard"] as const;
const AVAILABILITY_TAGS = ["product:availability", "og:availability", "product:stock"] as const;
const TITLE_TAGS = ["og:title", "twitter:title"] as const;
const IMAGE_TAGS = ["og:image:secure_url", "og:image", "twitter:image"] as const;

/** Reads a meta tag's content, tolerating `property=` vs `name=`. */
export function metaContent($: StrategyContext["$"], tag: string): string | undefined {
  const selector = `meta[property="${tag}"], meta[name="${tag}"]`;
  for (const element of $(selector).toArray()) {
    const content = $(element).attr("content")?.trim();
    if (content && content.length > 0) {
      return content;
    }
  }
}

export function firstMeta($: StrategyContext["$"], tags: readonly string[]): string | undefined {
  for (const tag of tags) {
    const content = metaContent($, tag);
    if (content) {
      return content;
    }
  }
}

export function extractOpenGraph({ $, locale }: StrategyContext): PriceCandidate | null {
  const rawPrice = firstMeta($, PRICE_TAGS);
  if (!rawPrice) {
    return null;
  }
  const parsed = parsePrice(rawPrice, { currency: firstMeta($, CURRENCY_TAGS), locale });
  if (!parsed) {
    return null;
  }

  const candidate: PriceCandidate = {
    confidence: "low",
    evidence: { type: "opengraph:page-metadata" },
    price: parsed.amount,
  };
  if (parsed.currency) {
    candidate.currency = parsed.currency;
  }

  const availability = parseAvailability(firstMeta($, AVAILABILITY_TAGS));
  if (availability) {
    candidate.availability = availability.availability;
    if (availability.inStock !== undefined) {
      candidate.inStock = availability.inStock;
    }
  }

  const title = firstMeta($, TITLE_TAGS);
  if (title) {
    candidate.title = title;
  }
  const imageUrl = firstMeta($, IMAGE_TAGS);
  if (imageUrl) {
    candidate.imageUrl = imageUrl;
  }
  return candidate;
}

/** Page-level title/image used to backfill whichever strategy won. */
export function extractPageMetadata($: StrategyContext["$"]): {
  imageUrl?: string;
  title?: string;
} {
  const metadata: { imageUrl?: string; title?: string } = {};
  const title = firstMeta($, TITLE_TAGS) ?? $("title").first().text().trim();
  if (title && title.length > 0) {
    metadata.title = title;
  }
  const imageUrl = firstMeta($, IMAGE_TAGS) ?? $('link[rel="image_src"]').attr("href")?.trim();
  if (imageUrl && imageUrl.length > 0) {
    metadata.imageUrl = imageUrl;
  }
  return metadata;
}
