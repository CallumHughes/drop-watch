/**
 * Shared JSON helpers. Lifted out of `./jsonld` once the JSONPath strategy
 * needed the same parsing and the same walk bounds — one copy, so a document
 * that is safe to walk in one strategy is safe to walk in the other.
 *
 * No cheerio import here: `./expression-guard` reaches this module through
 * `./json-path`, and that guard is loaded by the browser bundle.
 */

/** Depth cap on a JSON walk — real documents nest a handful of levels. */
export const MAX_WALK_DEPTH = 12;
/** Node cap, so a pathological document cannot pin the event loop. */
export const MAX_NODES = 2000;

const CDATA_WRAPPER = /^\s*(?:\/\*\s*)?<!\[CDATA\[|\]\]>(?:\s*\*\/)?\s*$/g;
const HTML_COMMENT = /^\s*<!--|-->\s*$/g;

export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

/** Parses a `<script>` body, tolerating the CDATA and comment wrappers CMSes add. */
export function parseScript(raw: string): unknown {
  const cleaned = raw.replace(CDATA_WRAPPER, "").replace(HTML_COMMENT, "").trim();
  if (cleaned.length === 0) {
    return null;
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}
