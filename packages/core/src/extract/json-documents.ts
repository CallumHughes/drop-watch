/**
 * Every JSON document a page carries, in the order worth trying.
 *
 * The JSONPath strategy exists for prices that never become text: a Next.js
 * `__NEXT_DATA__` payload, a Nuxt state blob, or a JSON endpoint tracked
 * directly. Those live in four different places, so finding them is its own
 * concern rather than something the strategy open-codes.
 *
 * A blob that is JavaScript rather than JSON (functions, `undefined`, trailing
 * commas) fails to parse and is skipped. That is the intended degradation —
 * this module does not evaluate anything.
 */

import { parseScript } from "./json";
import type { StrategyContext } from "./types";

/** Enough for a page that inlines several stores; a bound, not a target. */
const MAX_DOCUMENTS = 20;
/** Per-document ceiling, so one enormous blob cannot pin the event loop. */
const MAX_DOCUMENT_CHARS = 2_000_000;

/**
 * `window.__NEXT_DATA__ = {`, `var __NUXT__ = {`, `window.foo = [`. The
 * lookahead is what keeps this from matching ordinary assignments — only a
 * literal object or array can be a document.
 */
const INLINE_ASSIGNMENT =
  /(?:(?:window|globalThis|self)\s*\.\s*|(?:var|let|const)\s+)([A-Za-z_$][\w$]*)\s*=\s*(?=[{[])/g;
const NON_CODE_TOKEN =
  /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g;
const NON_NEWLINE = /[^\r\n]/g;
const EXECUTABLE_SCRIPT_TYPES = new Set([
  "",
  "application/ecmascript",
  "application/javascript",
  "module",
  "text/ecmascript",
  "text/javascript",
]);

export interface JsonDocument {
  /** Where it came from, shown as the context line in the picker. */
  source: string;
  value: unknown;
}

export function collectJsonDocuments({
  $,
  html,
}: Pick<StrategyContext, "$" | "html">): JsonDocument[] {
  const documents: JsonDocument[] = [];

  // A tracked URL that answers with JSON rather than a page.
  const body = parseScript(html.slice(0, MAX_DOCUMENT_CHARS));
  if (body !== null) {
    documents.push({ source: "response body", value: body });
  }

  // `__NEXT_DATA__` ships with exactly this type, so it lands here.
  collectScripts($, 'script[type="application/json"]', documents);
  collectScripts($, 'script[type="application/ld+json"]', documents);
  collectInlineAssignments($, documents);

  return documents.slice(0, MAX_DOCUMENTS);
}

function collectScripts(
  $: StrategyContext["$"],
  selector: string,
  documents: JsonDocument[]
): void {
  for (const element of $(selector).toArray()) {
    if (documents.length >= MAX_DOCUMENTS) {
      return;
    }
    const node = $(element);
    const parsed = parseScript(node.text().slice(0, MAX_DOCUMENT_CHARS));
    if (parsed !== null) {
      const id = node.attr("id");
      documents.push({ source: id ? `<script id="${id}">` : selector, value: parsed });
    }
  }
}

function collectInlineAssignments($: StrategyContext["$"], documents: JsonDocument[]): void {
  for (const element of $("script:not([src])").toArray()) {
    if (documents.length >= MAX_DOCUMENTS) {
      return;
    }
    const node = $(element);
    if (!isExecutableScript(node.attr("type"))) {
      continue;
    }
    scanInlineAssignments(node.text(), documents);
  }
}

function isExecutableScript(type: string | undefined): boolean {
  const normalized = type?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return EXECUTABLE_SCRIPT_TYPES.has(normalized);
}

/** Blanks strings and comments without moving assignment positions. */
function executableCode(source: string): string {
  return source.replace(NON_CODE_TOKEN, (token) => token.replace(NON_NEWLINE, " "));
}

function scanInlineAssignments(source: string, documents: JsonDocument[]): void {
  const code = executableCode(source);
  INLINE_ASSIGNMENT.lastIndex = 0;
  let match = INLINE_ASSIGNMENT.exec(code);
  // biome-ignore lint/suspicious/noUnnecessaryConditions: exec returns null when no assignments remain.
  while (match !== null) {
    if (documents.length >= MAX_DOCUMENTS) {
      return;
    }
    const literal = readJsonLiteral(source, match.index + match[0].length);
    if (literal) {
      try {
        documents.push({ source: `${match[1]} =`, value: JSON.parse(literal.value) as unknown });
      } catch {
        // JavaScript, not JSON. Skipping is the point.
      }
      // Do not rediscover assignment-shaped strings inside the literal itself.
      INLINE_ASSIGNMENT.lastIndex = literal.end;
    }
    match = INLINE_ASSIGNMENT.exec(code);
  }
}

interface JsonLiteralRead {
  end: number;
  value: string;
}

/**
 * The object or array literal starting at `start`, found by counting brackets
 * while respecting string literals and their escapes.
 *
 * Slicing on the next `}` would truncate at the first brace inside a string,
 * and a price is very often quoted next to markup that contains one.
 */
function readJsonLiteral(source: string, start: number): JsonLiteralRead | null {
  const open = source.charAt(start);
  const close = open === "{" ? "}" : "]";
  const limit = Math.min(source.length, start + MAX_DOCUMENT_CHARS);
  let depth = 0;
  let quote = "";

  for (let index = start; index < limit; index += 1) {
    const char = source.charAt(index);
    if (quote !== "") {
      if (char === "\\") {
        index += 1;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === open) {
      depth += 1;
    } else if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return { end: index + 1, value: source.slice(start, index + 1) };
      }
    }
  }
  return null;
}

/** How a resolved value reads in the picker's match list. */
export function describeJsonValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined) {
    return "undefined";
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
