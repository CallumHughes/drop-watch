/**
 * Plain-text title + body for the push-style channels (ntfy, Discord,
 * Telegram) — no HTML, no template, just a line worth reading in a
 * notification tray.
 *
 * Duplicates a few lines of `@drop-watch/email`'s format.ts rather than
 * sharing them, for the same reason that file gives for duplicating
 * `apps/web`: this lives in core, which the mailer depends on, not the other
 * way round. `productHost` is the one exception — it is exported so the email
 * templates can import it directly instead of keeping a third copy, since
 * that dependency runs the allowed way (email already depends on core).
 * Prices stay decimal strings throughout — never `Number`.
 */

import type { NotificationKind, NotificationPayload } from "./index";

const WWW_PREFIX = /^www\./;

/**
 * The store a listing's URL belongs to, `www.` stripped. Exported: a product
 * can now be watched at more than one store, so naming the store is what
 * makes an alert actionable, and both this module and the email templates
 * need the same derivation.
 */
export function productHost(url: string): string {
  try {
    return new URL(url).hostname.replace(WWW_PREFIX, "");
  } catch {
    return url;
  }
}

function productLabel(payload: NotificationPayload): string {
  return payload.title ?? productHost(payload.url);
}

/**
 * `label` with its store appended, e.g. "Bulbasaur at scrapeme.live". Skipped
 * when `label` is already the hostname (extraction never found a title) —
 * "scrapeme.live at scrapeme.live" says nothing twice.
 */
function withStore(label: string, url: string): string {
  const host = productHost(url);
  return label === host ? label : `${label} at ${host}`;
}

/** Exact currency rendering of a decimal string; falls back to bare digits. */
function formatPrice(price: string, currency: string | null): string {
  if (!currency) {
    return price;
  }
  try {
    return new Intl.NumberFormat("en-GB", { currency, style: "currency" }).format(
      price as Intl.StringNumericLiteral
    );
  } catch {
    return `${price} ${currency}`;
  }
}

function formatPercentChange(pctChange: string): string {
  return pctChange.startsWith("-") ? `${pctChange}%` : `+${pctChange}%`;
}

/** Title, one per {@link NotificationKind}. Exhaustive by construction. */
const TITLES: Record<NotificationKind, (label: string) => string> = {
  drop_percent: (label) => `Price drop: ${label}`,
  restock: (label) => `Back in stock: ${label}`,
  target: (label) => `Target hit: ${label}`,
  test: () => "Test alert from DropWatch",
  watch_broken: (label) => `Watch broken: ${label}`,
};

function priceLines(payload: NotificationPayload): string[] {
  const lines: string[] = [];
  if (payload.price !== null) {
    const price = formatPrice(payload.price, payload.currency);
    lines.push(
      payload.previousPrice === null
        ? price
        : `${price} (was ${formatPrice(payload.previousPrice, payload.currency)})`
    );
  }
  if (payload.pctChange !== null) {
    lines.push(formatPercentChange(payload.pctChange));
  }
  if (payload.inStock !== null) {
    lines.push(payload.inStock ? "In stock" : "Out of stock");
  }
  return lines;
}

function watchBrokenLines(payload: NotificationPayload): string[] {
  const failures = payload.consecutiveFailures;
  const lines = [
    failures === null
      ? "Checks for this product keep failing."
      : `The last ${failures} checks failed in a row.`,
  ];
  if (payload.error) {
    lines.push(payload.error);
  }
  return lines;
}

/** A short title and a body, one payload each — what a push notification wants. */
export interface AlertMessage {
  body: string;
  title: string;
}

function bodyLines(payload: NotificationPayload): string[] {
  if (payload.rule === "watch_broken") {
    return watchBrokenLines(payload);
  }
  if (payload.rule === "test") {
    return ["This is a test notification."];
  }
  return priceLines(payload);
}

/** Builds the title + body a push channel sends. Never throws. */
export function alertMessage(payload: NotificationPayload): AlertMessage {
  const label = withStore(productLabel(payload), payload.url);
  const title = TITLES[payload.rule](label);
  const lines = bodyLines(payload);
  lines.push(payload.url);
  return { body: lines.join("\n"), title };
}
