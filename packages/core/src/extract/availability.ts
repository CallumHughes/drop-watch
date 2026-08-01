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

/** Display-level stock state, richer than the plain boolean the rules engine compares. */
export type AvailabilityState =
  | "back_order"
  | "discontinued"
  | "in_stock"
  | "limited"
  | "out_of_stock"
  | "pre_order"
  | "unknown";

/** Specific tokens mapped ahead of the plain in/out-of-stock split. */
const STATE_TOKENS: ReadonlyMap<string, AvailabilityState> = new Map([
  ["backorder", "back_order"],
  ["discontinued", "discontinued"],
  ["limitedavailability", "limited"],
  ["preorder", "pre_order"],
  ["presale", "pre_order"],
]);

/**
 * The richest state a stored `availability` token (plus the `inStock`
 * boolean derived from it) can support. Falls back to the boolean, then to
 * "unknown" when neither says anything.
 */
export function availabilityState(
  availability: string | null,
  inStock: boolean | null
): AvailabilityState {
  const key = availability?.toLowerCase().replace(SEPARATORS, "");
  const state = key ? STATE_TOKENS.get(key) : undefined;
  if (state) {
    return state;
  }
  if (inStock === null) {
    return "unknown";
  }
  return inStock ? "in_stock" : "out_of_stock";
}
