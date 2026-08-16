/**
 * A deliberately small JSONPath: enough to reach a price inside an embedded
 * state blob, and nothing that can execute anything.
 *
 * The full grammar includes filter and script expressions (`?(@.price > 10)`),
 * which every mainstream implementation evaluates as JavaScript. These
 * expressions come from users and are evaluated inside the worker, so that half
 * of the grammar is not implemented rather than sandboxed.
 *
 * Supported: `$`, `.name`, `['name']`, `["name"]`, `[n]`, `[*]`, `.*`, `..name`.
 * Anything else is a parse error naming what it saw, because a half-typed path
 * should read as "keep typing", not as "no match".
 */

import { isRecord, MAX_NODES, MAX_WALK_DEPTH } from "./json";

export type JsonPathSegment =
  | { name: string; type: "property" }
  | { index: number; type: "index" }
  | { type: "wildcard" }
  | { name: string; type: "descend" };

export interface ParsedJsonPath {
  segments: readonly JsonPathSegment[];
}

export interface JsonPathError {
  error: string;
}

const NAME_START = /[A-Za-z_$]/;
const NAME_CHAR = /[A-Za-z0-9_$-]/;
const DIGITS = /^\d+$/;

interface NameRead {
  end: number;
  name: string;
}

function readName(source: string, start: number): NameRead | null {
  if (start >= source.length || !NAME_START.test(source.charAt(start))) {
    return null;
  }
  let end = start + 1;
  while (end < source.length && NAME_CHAR.test(source.charAt(end))) {
    end += 1;
  }
  return { end, name: source.slice(start, end) };
}

interface SegmentRead {
  end: number;
  segment: JsonPathSegment;
}

/** Quoted keys are scanned to their closing quote first, so `['a]b']` works. */
function readQuoted(source: string, open: number, quote: string): SegmentRead | JsonPathError {
  const quoteEnd = source.indexOf(quote, open + 2);
  if (quoteEnd === -1) {
    return { error: `unterminated ${quote} in \`[\` at position ${open}` };
  }
  const close = source.indexOf("]", quoteEnd + 1);
  if (close === -1) {
    return { error: `unclosed \`[\` at position ${open}` };
  }
  if (source.slice(quoteEnd + 1, close).trim().length > 0) {
    return { error: `unexpected text after the quoted key in \`[\` at position ${open}` };
  }
  return { end: close + 1, segment: { name: source.slice(open + 2, quoteEnd), type: "property" } };
}

function readBracket(source: string, open: number): SegmentRead | JsonPathError {
  const first = source.charAt(open + 1);
  if (first === "'" || first === '"') {
    return readQuoted(source, open, first);
  }

  const close = source.indexOf("]", open + 1);
  if (close === -1) {
    return { error: `unclosed \`[\` at position ${open}` };
  }
  const inner = source.slice(open + 1, close).trim();
  if (inner === "*") {
    return { end: close + 1, segment: { type: "wildcard" } };
  }
  if (DIGITS.test(inner)) {
    return { end: close + 1, segment: { index: Number(inner), type: "index" } };
  }
  return {
    error: `unsupported \`[${inner}]\` — this JSONPath understands [n], [*], ['name'] and ["name"] only`,
  };
}

export function parseJsonPath(expression: string): ParsedJsonPath | JsonPathError {
  const source = expression.trim();
  if (source.length === 0) {
    return { error: "no expression" };
  }
  if (source.charAt(0) !== "$") {
    return { error: "a JSONPath must start with `$`, e.g. `$..price`" };
  }

  const segments: JsonPathSegment[] = [];
  let index = 1;
  while (index < source.length) {
    const char = source.charAt(index);

    if (char === "[") {
      const bracket = readBracket(source, index);
      if ("error" in bracket) {
        return bracket;
      }
      segments.push(bracket.segment);
      index = bracket.end;
      continue;
    }

    if (char !== ".") {
      return { error: `unexpected \`${char}\` at position ${index} — expected \`.\` or \`[\`` };
    }

    if (source.charAt(index + 1) === ".") {
      const descendant = readName(source, index + 2);
      if (!descendant) {
        return { error: "`..` must be followed by a property name, e.g. `$..price`" };
      }
      segments.push({ name: descendant.name, type: "descend" });
      index = descendant.end;
      continue;
    }

    if (source.charAt(index + 1) === "*") {
      segments.push({ type: "wildcard" });
      index += 2;
      continue;
    }

    const property = readName(source, index + 1);
    if (!property) {
      return { error: `\`.\` at position ${index} must be followed by a property name` };
    }
    segments.push({ name: property.name, type: "property" });
    index = property.end;
  }

  return { segments };
}

/**
 * Every value the path resolves to, in document order.
 *
 * `$` alone resolves to the whole document, which is the useful answer when the
 * tracked URL is a JSON endpoint that returns the price at its root.
 */
export function evaluateJsonPath(path: ParsedJsonPath, value: unknown): unknown[] {
  let current: unknown[] = [value];
  for (const segment of path.segments) {
    const next: unknown[] = [];
    for (const node of current) {
      if (next.length >= MAX_NODES) {
        break;
      }
      applySegment(segment, node, next);
    }
    if (next.length === 0) {
      return [];
    }
    current = next;
  }
  return current;
}

function applySegment(segment: JsonPathSegment, node: unknown, out: unknown[]): void {
  if (segment.type === "property") {
    // Own properties only: `in` would resolve `$..constructor` against
    // Object.prototype and hand the caller a function to price.
    if (isRecord(node) && Object.hasOwn(node, segment.name)) {
      out.push(node[segment.name]);
    }
    return;
  }
  if (segment.type === "index") {
    if (Array.isArray(node) && segment.index < node.length) {
      out.push(node[segment.index]);
    }
    return;
  }
  if (segment.type === "wildcard") {
    pushAll(childrenOf(node), out);
    return;
  }
  descend(node, segment.name, out, 0);
}

/** A wildcard means every element of an array or every value of an object. */
function childrenOf(node: unknown): unknown[] {
  if (Array.isArray(node)) {
    return node;
  }
  return isRecord(node) ? Object.values(node) : [];
}

/** Spread would blow the stack on a large array; this cannot. */
function pushAll(values: unknown[], out: unknown[]): void {
  for (const value of values) {
    if (out.length >= MAX_NODES) {
      return;
    }
    out.push(value);
  }
}

function descend(node: unknown, name: string, out: unknown[], depth: number): void {
  if (depth > MAX_WALK_DEPTH || out.length >= MAX_NODES) {
    return;
  }
  if (Array.isArray(node)) {
    for (const entry of node) {
      descend(entry, name, out, depth + 1);
    }
    return;
  }
  if (!isRecord(node)) {
    return;
  }
  if (Object.hasOwn(node, name)) {
    out.push(node[name]);
  }
  for (const entry of Object.values(node)) {
    descend(entry, name, out, depth + 1);
  }
}
