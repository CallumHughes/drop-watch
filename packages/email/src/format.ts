/**
 * Display helpers for the templates.
 *
 * The rule this file exists to keep is the same one the schema and the web
 * views keep: **a price is never a float**. `Intl.NumberFormat` accepts a
 * decimal string and formats it exactly, so a `numeric(12,2)` value reaches
 * someone's inbox as the digits Postgres stored, not as whatever the nearest
 * double rounded to.
 *
 * This deliberately duplicates a few lines of `apps/web/src/lib/format.ts`
 * rather than sharing them. The worker renders these templates too and cannot
 * import from `apps/web`; pushing display code into `@price-tracker/core`
 * would give a package that is otherwise pure logic a presentation layer.
 * Two small copies beat either.
 */

import type { NotificationPayload } from "@price-tracker/core/notify";

/** `www.` carries no information on a host label, so it is dropped. */
const WWW_PREFIX = /^www\./;

/**
 * Exact currency rendering of a `numeric(12,2)` string. Falls back to the bare
 * digits when the page never told us a currency — better an unlabelled number
 * than a confidently wrong currency symbol.
 */
export function formatPrice(price: string, currency: string | null): string {
  if (!currency) {
    return price;
  }
  try {
    // The formatter takes decimal strings and formats them exactly. TypeScript
    // wants the `${number}` template type, which every `numeric(12,2)` is.
    return new Intl.NumberFormat("en-GB", { currency, style: "currency" }).format(
      price as Intl.StringNumericLiteral
    );
  } catch {
    // A currency code the page invented is not worth throwing an email away
    // for, and `Intl` throws on codes it does not recognise.
    return `${price} ${currency}`;
  }
}

/** The bare host of a URL, or the whole string when it will not parse. */
export function productHost(url: string): string {
  try {
    return new URL(url).hostname.replace(WWW_PREFIX, "");
  } catch {
    return url;
  }
}

/**
 * What to call the product in a subject line or a heading. Extraction may
 * never have found a title, and "(untitled)" in someone's inbox is worse than
 * the shop's hostname.
 */
export function productLabel(payload: NotificationPayload): string {
  return payload.title ?? productHost(payload.url);
}

/**
 * The signed percentage change, already rounded to one decimal place upstream
 * and passed straight through — parsing it here would reintroduce the float
 * this codebase spends so much effort avoiding.
 */
export function formatPercentChange(pctChange: string): string {
  return pctChange.startsWith("-") ? `${pctChange}%` : `+${pctChange}%`;
}
