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
/**
 * Member targets (`theme.settings = {`) are common enough on storefronts to
 * crowd out everything else, so they get their own budget after the rest.
 */
const MAX_MEMBER_DOCUMENTS = 20;
/** Per-document ceiling, so one enormous blob cannot pin the event loop. */
const MAX_DOCUMENT_CHARS = 2_000_000;

/**
 * `window.__NEXT_DATA__ = {`, `var __NUXT__ = {`, `window.foo = [`, and
 * member targets such as `_BISConfig.product = {`. The lookahead is what keeps
 * this from matching ordinary assignments — only a literal object or array can
 * be a document.
 */
const INLINE_ASSIGNMENT =
  /(?<![\w$.])(?:(?:window|globalThis|self)\s*\.\s*(?<global>[A-Za-z_$][\w$]*)|(?:var|let|const)\s+(?<declared>[A-Za-z_$][\w$]*)|(?<member>[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)+))\s*=\s*(?=[{[])/gu;
const NON_CODE_TOKEN =
  /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//gu;
const NON_NEWLINE = /[^\r\n]/gu;
const WHITESPACE = /\s+/gu;
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

/** One parse per loaded page: the chain, the stock backfill and the suggester all ask. */
const collected = new WeakMap<StrategyContext["$"], readonly JsonDocument[]>();

export function collectJsonDocuments({
  $,
  html,
}: Pick<StrategyContext, "$" | "html">): readonly JsonDocument[] {
  const cached = collected.get($);
  if (cached) {
    return cached;
  }

  const documents: JsonDocument[] = [];

  // A tracked URL that answers with JSON rather than a page.
  const body = parseScript(html.slice(0, MAX_DOCUMENT_CHARS));
  if (body !== null) {
    documents.push({ source: "response body", value: body });
  }

  // `__NEXT_DATA__` ships with exactly this type, so it lands here.
  collectScripts($, 'script[type="application/json"]', documents);
  collectScripts($, 'script[type="application/ld+json"]', documents);

  const scripts = inlineScripts($);
  for (const script of scripts) {
    scanInlineAssignments(script, documents, "named", MAX_DOCUMENTS);
  }
  const members: JsonDocument[] = [];
  for (const script of scripts) {
    scanInlineAssignments(script, members, "member", MAX_MEMBER_DOCUMENTS);
  }

  const result = [...documents.slice(0, MAX_DOCUMENTS), ...members];
  collected.set($, result);
  return result;
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

interface InlineScript {
  /** The source with strings and comments blanked, so offsets line up. */
  code: string;
  source: string;
}

function inlineScripts($: StrategyContext["$"]): InlineScript[] {
  const scripts: InlineScript[] = [];
  for (const element of $("script:not([src])").toArray()) {
    const node = $(element);
    if (isExecutableScript(node.attr("type"))) {
      const source = node.text();
      scripts.push({ code: executableCode(source), source });
    }
  }
  return scripts;
}

function isExecutableScript(type: string | undefined): boolean {
  const normalized = type?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return EXECUTABLE_SCRIPT_TYPES.has(normalized);
}

/** Blanks strings and comments without moving assignment positions. */
function executableCode(source: string): string {
  return source.replace(NON_CODE_TOKEN, (token) =>
    token.replace(NON_NEWLINE, (char) => " ".repeat(char.length))
  );
}

/** `named` is `window.x` and `var x`; `member` is `a.b`. */
type AssignmentKind = "member" | "named";

function scanInlineAssignments(
  { code, source }: InlineScript,
  documents: JsonDocument[],
  kind: AssignmentKind,
  limit: number
): void {
  INLINE_ASSIGNMENT.lastIndex = 0;
  let match = INLINE_ASSIGNMENT.exec(code);
  while (match !== null && documents.length < limit) {
    const member = match.groups?.member;
    const name = member ?? match.groups?.global ?? match.groups?.declared;
    const literal =
      (member ? "member" : "named") === kind
        ? readJsonLiteral(source, match.index + match[0].length)
        : null;
    if (literal) {
      try {
        documents.push({
          source: `${name?.replace(WHITESPACE, "")} =`,
          value: JSON.parse(literal.value) as unknown,
        });
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
    // biome-ignore lint/suspicious/noUnnecessaryConditions: JSON.stringify returns undefined for functions and symbols.
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
