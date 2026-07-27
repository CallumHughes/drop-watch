/**
 * Display helpers for the price views.
 *
 * `Intl.NumberFormat` is fed the raw decimal string rather than a number:
 * ES2023 formatters accept strings and format them exactly, which keeps the
 * "never through a float" rule (PLAN.md §10) intact all the way to the pixel.
 */

/** Live views poll rather than push. SSE is the upgrade path — see PLAN.md §8. */
export const LIVE_REFETCH_MS = 15_000;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const dateTime = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  month: "short",
});

/** Exact currency rendering of a `numeric(12,2)` string. */
export function formatPrice(price: string, currency: string | null): string {
  if (!currency) {
    return price;
  }
  // The formatter takes decimal strings and formats them exactly. TypeScript
  // wants the `${number}` template type, which every `numeric(12,2)` value is.
  return new Intl.NumberFormat("en-GB", { currency, style: "currency" }).format(
    price as Intl.StringNumericLiteral
  );
}

/** "3 minutes ago" / "in 2 hours", from a timestamp on either side of now. */
export function formatRelative(when: Date, now = Date.now()): string {
  const deltaMs = when.getTime() - now;
  const magnitude = Math.abs(deltaMs);
  if (magnitude < HOUR_MS) {
    return relative.format(Math.round(deltaMs / MINUTE_MS), "minute");
  }
  if (magnitude < DAY_MS) {
    return relative.format(Math.round(deltaMs / HOUR_MS), "hour");
  }
  return relative.format(Math.round(deltaMs / DAY_MS), "day");
}

export function formatDateTime(when: Date): string {
  return dateTime.format(when);
}

export function formatDuration(durationMs: number | null): string {
  if (durationMs === null) {
    return "—";
  }
  return durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`;
}

/** `www.` carries no information on a host label, so it is dropped. */
const WWW_PREFIX = /^www\./;

/**
 * The bare host of a product URL, as every view labels one. Falls back to the
 * whole string rather than throwing: a saved product's URL has always been
 * validated, but a preview shows one the user is still typing.
 */
export function productHost(url: string): string {
  try {
    return new URL(url).hostname.replace(WWW_PREFIX, "");
  } catch {
    return url;
  }
}

/** Stock label. `null` means the page never said, which is not the same as no. */
export function formatStock(inStock: boolean | null): string {
  if (inStock === null) {
    return "Stock unknown";
  }
  return inStock ? "In stock" : "Out of stock";
}
