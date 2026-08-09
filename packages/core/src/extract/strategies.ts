/**
 * The names of every extraction strategy, and the subsets each layer cares
 * about. One list, no imports — which is the point.
 *
 * `listings.extractor` is a plain text column rather than a pg enum for the
 * same reason `check_runs.extractor_used` always was: strategy names are owned
 * by this package, not by Postgres. Keeping them here means adding a strategy
 * is a TypeScript change, not a migration.
 *
 * Nothing may be imported into this module. The zod schemas in `@drop-watch/api`
 * read it and are reachable from the browser bundle, so it must never pull in
 * cheerio or the database package.
 */

/** Every link in the extraction chain. Everything else here derives from it. */
export const EXTRACTOR_STRATEGIES = [
  "jsonld",
  "microdata",
  "opengraph",
  "selector",
  "regex",
  "jsonpath",
] as const;

export type ExtractorStrategy = (typeof EXTRACTOR_STRATEGIES)[number];

/**
 * The strategies driven by a user-supplied expression — the ones a listing can
 * be pinned to. The rest read the page's own structured data and take no input.
 */
export const EXPRESSION_MODES = ["selector", "regex", "jsonpath"] as const;

export type ExpressionMode = (typeof EXPRESSION_MODES)[number];

/** What `listings.extractor` holds: a pinned expression strategy, or the chain. */
export const LISTING_EXTRACTORS = ["auto", ...EXPRESSION_MODES] as const;

export type ListingExtractor = (typeof LISTING_EXTRACTORS)[number];

/** Narrows a text column to a pinned mode; `undefined` for `auto` or anything unknown. */
export function toExpressionMode(value: string): ExpressionMode | undefined {
  return EXPRESSION_MODES.find((mode) => mode === value);
}
