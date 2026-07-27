/**
 * schema.org / OpenGraph availability normalisation.
 *
 * `offers.availability` is what powers restock alerts, so it is captured
 * verbatim (as the bare schema.org token) alongside the boolean the rules
 * engine actually compares.
 */

import type { Availability } from "./types";

const URL_SEGMENT = /[#/]/;
const SEPARATORS = /[\s_-]/g;

/** Tokens that mean the item can be bought right now. */
const IN_STOCK_TOKENS: ReadonlySet<string> = new Set([
  "available",
  "instock",
  "instoreonly",
  "limitedavailability",
  "onlineonly",
  "true",
  "yes",
]);

/** Tokens that mean it cannot — pre-orders and back-orders included. */
const OUT_OF_STOCK_TOKENS: ReadonlySet<string> = new Set([
  "backorder",
  "discontinued",
  "false",
  "no",
  "oos",
  "outofstock",
  "preorder",
  "presale",
  "soldout",
  "unavailable",
]);

/**
 * Turns "https://schema.org/InStock", "InStock" or "instock" into a normalised
 * token plus a boolean. Returns null for empty input.
 */
export function parseAvailability(raw: string | undefined | null): Availability | null {
  if (!raw) {
    return null;
  }
  const segments = raw.trim().split(URL_SEGMENT);
  const token = segments.at(-1)?.trim();
  if (!token) {
    return null;
  }

  const key = token.toLowerCase().replace(SEPARATORS, "");
  if (IN_STOCK_TOKENS.has(key)) {
    return { availability: token, inStock: true };
  }
  if (OUT_OF_STOCK_TOKENS.has(key)) {
    return { availability: token, inStock: false };
  }
  return { availability: token };
}
