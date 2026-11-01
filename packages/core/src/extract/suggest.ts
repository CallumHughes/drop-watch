/**
 * Finding the expression that reads a price the user can already see.
 *
 * Authoring a CSS selector or a JSONPath is the wrong job to hand a person
 * repairing a watch: they can read the price off the page, but they cannot
 * reasonably be asked to point at it in the markup. The value they type is an
 * exact oracle, which is what makes suggesting an expression safe at all — a
 * candidate is correct iff it matches exactly one thing and that thing parses
 * to their number. Without that test, "an element containing 24.99" is a coin
 * toss between the real price, a crossed-out RRP and a recommendation carousel.
 *
 * Pure, like every other module here: HTML in, candidates out. The caller
 * decides what to do with them, and the save path still re-tests the chosen one
 * through `testExpression`, so nothing here is trusted on its own.
 */

import { type CheerioAPI, load } from "cheerio";
import { toMinorUnits } from "../decimal";
import { isAmbiguousExtraction } from "./evidence";
import { parseSelectorExpression } from "./expression-guard";
import { type ExpressionMatch, extract } from "./index";
import { isRecord, MAX_NODES, MAX_WALK_DEPTH } from "./json";
import { collectJsonDocuments, describeJsonValue, type JsonDocument } from "./json-documents";
import { evaluateJsonPath, parseJsonPath } from "./json-path";
import { jsonValuePrice } from "./jsonpath";
import { type ParsedPrice, parsePrice } from "./price";
import { extractBySelector } from "./selector";
import type { CheerioElement, ExpressionMode, StrategyContext } from "./types";

/** Elements examined. A bound, not a target — real pages are far under it. */
const MAX_ELEMENTS = 6000;
/** Candidates actually run against the document. */
const MAX_VALIDATIONS = 40;
/** Returned candidates. The surplus beyond the first is for an agent or the
 * advanced picker; the UI applies the top one. */
const MAX_CANDIDATES = 5;
/** Distinct money values reported when nothing matched. */
const MAX_SIGHTINGS = 12;
/** Matches the picker's own sample budget in `./index`. */
const MAX_SAMPLE_CHARS = 300;
/**
 * Longest element text still treated as "this element is the price". Keeps a
 * leaf and a tight wrapper in, and every ancestor up to `<body>` out.
 */
const MAX_PRICE_TEXT_CHARS = 60;
/**
 * Letters tolerated in that text before it reads as prose. A price carries a
 * symbol, maybe a code, maybe "incl. VAT" — not "Free delivery over £24.99",
 * which parses to exactly the number the user typed and means something else
 * entirely. Validation cannot tell these apart; length can.
 */
const MAX_PRICE_TEXT_LETTERS = 6;
/**
 * Elements we will synthesise a selector for. Each synthesis costs several
 * document queries, so a page quoting one price five hundred times must not
 * turn one keystroke into thousands of traversals.
 */
const MAX_SYNTHESISED = 60;
/** Ancestors prepended while narrowing a selector. Beyond this it is a path,
 * and a path is what breaks next week. */
const MAX_SELECTOR_DEPTH = 3;
/** Ancestors read for context — struck-through markup, a carousel wrapper. */
const MAX_ANCESTOR_DEPTH = 6;

const COLLAPSE_WHITESPACE = /\s+/g;
const LETTERS = /\p{L}/gu;
/** Every numeric run in a string, so an element holding two prices is visible. */
const NUMBER_RUNS = /-?\d[\d\s.,'’]*/g;
const JSON_NAME = /^[A-Za-z_$][\w$-]*$/;
const CSS_IDENTIFIER = /^-?[A-Za-z_][\w-]*$/;
const QUOTES = /['"]/;
const MANY_DIGITS = /\d{4,}/;
/** `css-1x2y3z`, `sc-AbCdEf`, `jsx-123` — a build step's output, not a name. */
const GENERATED_PREFIX = /^(?:css|sc|jsx|emotion|svelte|_)-/i;
/** A trailing hash: a separator then a run mixing letters and digits. */
const HASHED_SUFFIX = /[-_](?=[a-z0-9]*\d)(?=[a-z0-9]*[a-z])[a-z0-9]{5,}$/i;
/** Names that say the element holds a price. */
const PRICE_TOKEN = /price|amount|cost|money|total|value/i;
/**
 * Names that say it holds a *different* price on the right product — the
 * crossed-out one. Validation cannot catch these: they parse to the same
 * number when the page is on offer at the figure the user read elsewhere.
 */
const STALE_PRICE_TOKEN = /compare|was|rrp|msrp|list|old|regular|strike|before|original/i;
/** Names that say it holds the right price for the *wrong* product. */
const OTHER_PRODUCT_TOKEN =
  /related|recommend|also|upsell|cross-?sell|carousel|recent|similar|bundle|you-?may|suggest/i;
/** Tailwind-shaped utilities: unstable and semantically empty. */
const UTILITY_CLASS =
  /^(?:text|font|bg|p|m|[pm][xytrbl]|w|h|min|max|flex|grid|gap|border|rounded|shadow|leading|tracking|items|justify|inline|block|hidden|absolute|relative|fixed|sticky|top|left|right|bottom|z|opacity|space|overflow|whitespace|align|order|col|row|gradient|from|to|via|sm|md|lg|xl|2xl)(?:-|$)/;
/** Attributes worth reading explicitly, most machine-readable first. */
const ATTRIBUTE_PREFERENCE = ["content", "data-price", "data-product-price", "value"] as const;
/** Attributes that identify an element without describing its looks. */
const IDENTIFYING_ATTRIBUTES = ["itemprop", "data-testid", "data-test", "data-qa", "data-price"];

/** `element.attribs` as it actually behaves: any name may simply be absent. */
type Attributes = Partial<Record<string, string>>;

export interface PriceSighting {
  /** Decimal string, as `parsePrice` produced it. */
  amount: string;
  /** Where it was seen, so the reader can tell two equal prices apart. */
  context: string;
  currency?: string;
}

export interface ExpressionCandidate {
  /**
   * The currency the expression itself yields. Absent means the listing must
   * already have one — the worker refuses a bare number, see `toCheckOutcome`.
   */
  currency?: string;
  expression: string;
  mode: ExpressionMode;
  /** Why it ranked where it did, in a sentence the UI can show. */
  reason: string;
  /** The matched value and its surroundings, shaped like the picker's samples. */
  sample: ExpressionMatch;
}

export interface SuggestOptions {
  /** Decimal string. Compared in minor units, never as a float. */
  expectedPrice: string;
  locale?: string;
  url?: string;
}

/** What the automatic chain makes of the page, next to what the user typed. */
export interface AutomaticVerdict {
  agrees: boolean;
  /** True when `isAmbiguousExtraction` will refuse to record it anyway. */
  ambiguous: boolean;
  currency?: string;
  price: string;
}

export interface Suggestion {
  automatic: AutomaticVerdict | null;
  /** Ranked most durable first. The UI applies the first. */
  candidates: ExpressionCandidate[];
  /** Every distinct money value on the page — the answer when nothing matched. */
  pricesOnPage: PriceSighting[];
}

function truncate(value: string, limit = MAX_SAMPLE_CHARS): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function collapse(value: string): string {
  return value.replace(COLLAPSE_WHITESPACE, " ").trim();
}

/** Scale-2 equality, which is the precision `numeric(12,2)` will store. */
function equalsExpected(price: string, expected: bigint): boolean {
  try {
    return toMinorUnits(price) === expected;
  } catch {
    return false;
  }
}

function looksGenerated(token: string): boolean {
  return (
    token.length > 40 ||
    GENERATED_PREFIX.test(token) ||
    HASHED_SUFFIX.test(token) ||
    MANY_DIGITS.test(token) ||
    !CSS_IDENTIFIER.test(token)
  );
}

function usableClasses(element: CheerioElement): string[] {
  const attributes: Attributes = "attribs" in element ? element.attribs : {};
  const raw = attributes.class ?? "";
  return raw
    .split(COLLAPSE_WHITESPACE)
    .filter((token) => token.length > 0 && !looksGenerated(token) && !UTILITY_CLASS.test(token));
}

/**
 * A selector for this element, and whether it only names its tag. A tag is a
 * last resort rather than a refusal: hashed and utility-only class names are
 * the norm on modern storefronts, and `.product-main span` beats no suggestion
 * at all as long as it currently matches one element holding the right number.
 */
interface SelfSelector {
  selector: string;
  weak: boolean;
}

/** Selectors that identify this element on its own, most durable first. */
function selfSelectors(element: CheerioElement): SelfSelector[] {
  const attributes: Attributes = "attribs" in element ? element.attribs : {};
  const tag = "tagName" in element ? element.tagName : "";
  const selectors: SelfSelector[] = [];

  for (const name of IDENTIFYING_ATTRIBUTES) {
    const value = attributes[name];
    if (value && !(looksGenerated(value) || QUOTES.test(value))) {
      selectors.push({ selector: `[${name}="${value}"]`, weak: false });
    }
  }
  const { id } = attributes;
  if (id && !looksGenerated(id)) {
    selectors.push({ selector: `#${id}`, weak: false });
  }

  const classes = usableClasses(element);
  // A name that says "price" outlives one that says how the thing looks.
  const named = classes.filter((token) => PRICE_TOKEN.test(token));
  for (const token of [...named, ...classes]) {
    selectors.push({ selector: `.${token}`, weak: false });
    if (tag) {
      selectors.push({ selector: `${tag}.${token}`, weak: false });
    }
  }
  if (tag) {
    selectors.push({ selector: tag, weak: true });
  }

  const seen = new Set<string>();
  return selectors.filter((entry) => {
    if (seen.has(entry.selector)) {
      return false;
    }
    seen.add(entry.selector);
    return true;
  });
}

function parentElement($: CheerioAPI, element: CheerioElement): CheerioElement | null {
  const parent = $(element).parent().get(0);
  if (!(parent && "tagName" in parent) || parent.tagName === "html") {
    return null;
  }
  return parent;
}

function identifies($: CheerioAPI, selector: string, element: CheerioElement): boolean {
  try {
    const matched = $(selector);
    return matched.length === 1 && matched.get(0) === element;
  } catch {
    return false;
  }
}

/**
 * The shortest selector that reaches this element and nothing else.
 *
 * Ancestors are prepended with the descendant combinator rather than `>` —
 * a store inserting one more wrapper div should not break the watch — and the
 * walk stops at {@link MAX_SELECTOR_DEPTH}. Positional selectors are never
 * emitted at all: `:nth-child(3)` is the expression that breaks next week.
 */
function narrowedSelector($: CheerioAPI, element: CheerioElement): SelfSelector | null {
  const own = selfSelectors(element);
  for (const entry of own) {
    if (!entry.weak && identifies($, entry.selector, element)) {
      return entry;
    }
  }

  let ancestor = parentElement($, element);
  for (let depth = 0; depth < MAX_SELECTOR_DEPTH && ancestor; depth += 1) {
    for (const prefix of selfSelectors(ancestor)) {
      if (prefix.weak) {
        continue;
      }
      for (const entry of own) {
        const combined = `${prefix.selector} ${entry.selector}`;
        if (identifies($, combined, element)) {
          return { selector: combined, weak: entry.weak };
        }
      }
    }
    ancestor = parentElement($, ancestor);
  }
  return null;
}

/** Where an element sits, for the reason line and the demotion rules. */
function ancestryText($: CheerioAPI, element: CheerioElement): string {
  const parts: string[] = [];
  let current: CheerioElement | null = element;
  for (let depth = 0; depth <= MAX_ANCESTOR_DEPTH && current; depth += 1) {
    const attributes: Attributes = "attribs" in current ? current.attribs : {};
    const tag = "tagName" in current ? current.tagName : "";
    parts.push(`${tag} ${attributes.class ?? ""} ${attributes.id ?? ""}`);
    current = parentElement($, current);
  }
  return parts.join(" ");
}

/** A candidate expression before it has been run against the page. */
interface Draft {
  expression: string;
  mode: ExpressionMode;
  /** Text around the match, read by the demotion rules and the reason line. */
  neighbourhood: string;
  /** The text holds more than one price, so the match depends on their order. */
  positional: boolean;
  /** The matched text reads as a sentence, not a price. */
  prose: boolean;
  /** Inside `<del>`, `<s>` or `<strike>` — the page's own "not this price". */
  struck: boolean;
  /** Durability tier: structured data, explicit attribute, then element text. */
  tier: 0 | 1 | 2;
  /** Identified only by its ancestors and tag. */
  weak: boolean;
}

interface Walked {
  drafts: Draft[];
  sightings: PriceSighting[];
}

/** Elements whose text is markup or data rather than something a shopper reads. */
const SKIPPED_TAGS = new Set(["script", "style", "noscript", "template", "head", "html"]);
const STRUCK_TAGS = new Set(["del", "s", "strike"]);
/** An attribute long enough to be a payload is not a price. */
const MAX_ATTRIBUTE_CHARS = 200;

/**
 * How many distinct prices a string holds.
 *
 * `parsePrice` reads the first numeric run, so an element wrapping both a
 * was-price and a sale price resolves to whichever the markup happens to put
 * first. That makes it a valid pin today and the wrong one the moment the
 * offer ends, which is worth demoting even though it validates.
 */
function distinctPrices(text: string, locale: string | undefined): number {
  const amounts = new Set<string>();
  for (const run of text.match(NUMBER_RUNS) ?? []) {
    const parsed = parsePrice(run, { ...(locale ? { locale } : {}) });
    if (parsed) {
      amounts.add(parsed.amount);
    }
  }
  return amounts.size;
}

function addSighting(sightings: PriceSighting[], sighting: PriceSighting): void {
  const key = `${sighting.amount}|${sighting.currency ?? ""}`;
  const seen = sightings.some((entry) => `${entry.amount}|${entry.currency ?? ""}` === key);
  if (!seen && sightings.length < MAX_SIGHTINGS) {
    sightings.push(sighting);
  }
}

function isStruck($: CheerioAPI, element: CheerioElement): boolean {
  let current: CheerioElement | null = element;
  for (let depth = 0; depth <= MAX_ANCESTOR_DEPTH && current; depth += 1) {
    if ("tagName" in current && STRUCK_TAGS.has(current.tagName)) {
      return true;
    }
    current = parentElement($, current);
  }
  return false;
}

/** Whether this element's own name says it holds a price. */
function isPriceNamed(attributes: Attributes): boolean {
  return PRICE_TOKEN.test(`${attributes.class ?? ""} ${attributes.itemprop ?? ""}`);
}

/**
 * The draft for an element whose text is the price.
 *
 * An element qualifies on its *whole* text, not its own text nodes, because
 * that is what `extractBySelector` reads — which is also why the text has to be
 * short: every ancestor up to `<body>` contains the price too, and only the
 * length bound tells a tight wrapper from the page.
 */
function textDraft(
  $: CheerioAPI,
  element: CheerioElement,
  text: string,
  locale: string | undefined
): Draft | null {
  const selector = narrowedSelector($, element);
  if (!selector) {
    return null;
  }
  return {
    expression: selector.selector,
    mode: "selector",
    neighbourhood: ancestryText($, element),
    positional: distinctPrices(text, locale) > 1,
    prose: (text.match(LETTERS)?.length ?? 0) > MAX_PRICE_TEXT_LETTERS,
    struck: isStruck($, element),
    tier: 2,
    weak: selector.weak,
  };
}

/** Attributes worth reading, paired with the value they hold. */
function priceAttributes(
  attributes: Attributes,
  expected: bigint,
  locale: string | undefined
): string[] {
  const names: string[] = [];
  for (const [name, value] of Object.entries(attributes)) {
    if (!value || value.length > MAX_ATTRIBUTE_CHARS) {
      continue;
    }
    const readable = ATTRIBUTE_PREFERENCE.includes(name as (typeof ATTRIBUTE_PREFERENCE)[number]);
    if (!(readable || name.startsWith("data-"))) {
      continue;
    }
    const parsed = parsePrice(value, { ...(locale ? { locale } : {}) });
    if (parsed && equalsExpected(parsed.amount, expected)) {
      names.push(name);
    }
  }
  return names;
}

function attributeDraft($: CheerioAPI, element: CheerioElement, name: string): Draft | null {
  const selector = narrowedSelector($, element);
  if (!selector) {
    return null;
  }
  // `content` and `value` are already read ahead of text by
  // `extractBySelector`, so naming them again only adds a moving part.
  const implicit = name === "content" || name === "value";
  return {
    expression: implicit ? selector.selector : `${selector.selector}::attr(${name})`,
    mode: "selector",
    neighbourhood: `${name} ${ancestryText($, element)}`,
    positional: false,
    prose: false,
    struck: isStruck($, element),
    tier: 1,
    weak: selector.weak,
  };
}

/**
 * The sighting this element contributes, if any.
 *
 * An ancestor's text starts with its first child's price, so without the leaf
 * test every wrapper up to `<body>` reports the same sighting.
 */
function recordSighting(
  node: ReturnType<CheerioAPI>,
  text: string,
  parsed: ParsedPrice | null,
  priceNamed: boolean,
  sightings: PriceSighting[]
): void {
  const holdsOnePrice = node.children().length === 0 || priceNamed;
  if (!(parsed && holdsOnePrice && (parsed.currency || priceNamed))) {
    return;
  }
  addSighting(sightings, {
    amount: parsed.amount,
    context: truncate(text, MAX_PRICE_TEXT_CHARS),
    ...(parsed.currency ? { currency: parsed.currency } : {}),
  });
}

/** Everything one element contributes, and how many selectors it cost. */
function inspectElement(
  $: CheerioAPI,
  element: CheerioElement,
  expected: bigint,
  locale: string | undefined,
  out: Walked
): number {
  if (!("tagName" in element) || SKIPPED_TAGS.has(element.tagName)) {
    return 0;
  }
  const node = $(element);
  const attributes: Attributes = element.attribs;
  const priceNamed = isPriceNamed(attributes);
  const text = collapse(node.text());
  const parsed =
    text.length > 0 && text.length <= MAX_PRICE_TEXT_CHARS
      ? parsePrice(text, { ...(locale ? { locale } : {}) })
      : null;

  recordSighting(node, text, parsed, priceNamed, out.sightings);

  let synthesised = 0;
  if (parsed && equalsExpected(parsed.amount, expected)) {
    synthesised += 1;
    const draft = textDraft($, element, text, locale);
    if (draft) {
      out.drafts.push(draft);
    }
  }
  for (const name of priceAttributes(attributes, expected, locale)) {
    synthesised += 1;
    const draft = attributeDraft($, element, name);
    if (draft) {
      out.drafts.push(draft);
    }
  }
  return synthesised;
}

/** Drafts from the markup, plus every money value seen along the way. */
function walkDom(context: StrategyContext, expected: bigint, locale: string | undefined): Walked {
  const { $ } = context;
  const out: Walked = { drafts: [], sightings: [] };
  let synthesised = 0;

  for (const element of $("*").toArray().slice(0, MAX_ELEMENTS)) {
    if (synthesised >= MAX_SYNTHESISED) {
      break;
    }
    synthesised += inspectElement($, element, expected, locale, out);
  }

  return out;
}

/** `$.a.b[2].price`, or null when a key cannot be written in this JSONPath. */
function concretePath(path: readonly (string | number)[]): string | null {
  let expression = "$";
  for (const segment of path) {
    if (typeof segment === "number") {
      expression += `[${segment}]`;
      continue;
    }
    if (JSON_NAME.test(segment)) {
      expression += `.${segment}`;
      continue;
    }
    if (QUOTES.test(segment)) {
      return null;
    }
    expression += `['${segment}']`;
  }
  return expression;
}

/**
 * The shorthand first, then the concrete path.
 *
 * `$..price` survives a payload being reshaped around it, so it is the most
 * durable thing this engine can produce. A concrete path carrying an array
 * index is not: reordering an `offers` array leaves it resolving to a different
 * offer at the same index, reading the wrong price and reporting success. That
 * is worse than breaking, so it drops out of the structured-data tier and sits
 * with the markup candidates, which at least fail loudly.
 */
function pathDrafts(path: readonly (string | number)[], source: string, drafts: Draft[]): void {
  const neighbourhood = `${source} ${path.join(".")}`;
  const last = path.at(-1);
  if (typeof last === "string" && JSON_NAME.test(last)) {
    drafts.push({
      expression: `$..${last}`,
      mode: "jsonpath",
      neighbourhood,
      positional: false,
      prose: false,
      struck: false,
      tier: 0,
      weak: false,
    });
  }
  const concrete = concretePath(path);
  if (!concrete) {
    return;
  }
  const indexed = path.some((segment) => typeof segment === "number");
  drafts.push({
    expression: concrete,
    mode: "jsonpath",
    neighbourhood,
    positional: indexed,
    prose: false,
    struck: false,
    tier: indexed ? 2 : 0,
    weak: false,
  });
}

function walkJsonValue(
  value: unknown,
  path: (string | number)[],
  depth: number,
  state: { nodes: number },
  expected: bigint,
  locale: string | undefined,
  source: string,
  out: Walked
): void {
  if (depth > MAX_WALK_DEPTH || state.nodes >= MAX_NODES) {
    return;
  }
  state.nodes += 1;

  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      walkJsonValue(entry, [...path, index], depth + 1, state, expected, locale, source, out);
    }
    return;
  }

  if (isRecord(value)) {
    // An offer-shaped object is worth pointing at in its own right: it is the
    // only shape that carries its own currency, and a bare number is a check
    // failure unless the listing already learned one.
    const offer = jsonValuePrice(value, locale);
    if (offer?.currency && equalsExpected(offer.amount, expected)) {
      pathDrafts(path, source, out.drafts);
    }
    for (const [key, entry] of Object.entries(value)) {
      walkJsonValue(entry, [...path, key], depth + 1, state, expected, locale, source, out);
    }
    return;
  }

  if (typeof value !== "number" && typeof value !== "string") {
    return;
  }
  const parsed = jsonValuePrice(value, locale);
  if (!parsed) {
    return;
  }
  const key = path.at(-1);
  if (typeof key === "string" && PRICE_TOKEN.test(key)) {
    addSighting(out.sightings, {
      amount: parsed.amount,
      context: `${source} ${path.join(".")}`,
      ...(parsed.currency ? { currency: parsed.currency } : {}),
    });
  }
  if (equalsExpected(parsed.amount, expected)) {
    pathDrafts(path, source, out.drafts);
  }
}

function walkJson(
  documents: readonly JsonDocument[],
  expected: bigint,
  locale: string | undefined
): Walked {
  const out: Walked = { drafts: [], sightings: [] };
  for (const document of documents) {
    walkJsonValue(document.value, [], 0, { nodes: 0 }, expected, locale, document.source, out);
  }
  return out;
}

/** Tier dominates every penalty; penalties only reorder within a tier's reach. */
const TIER_WEIGHT = 1000;
/** A bare number is a check failure unless the listing already has a currency. */
const NO_CURRENCY_PENALTY = 400;
const OTHER_PRODUCT_PENALTY = 300;
const PROSE_PENALTY = 350;
/** Which of several prices this reads depends on their order in the markup. */
const POSITIONAL_PENALTY = 300;
const STRUCK_PENALTY = 250;
/** Identified only by its ancestors and tag, so a markup change can move it. */
const WEAK_SELECTOR_PENALTY = 220;
const STALE_PRICE_PENALTY = 200;
/** Length only breaks ties: a shorter expression has fewer things to rot. */
const LENGTH_DIVISOR = 10;

type UnreasonedCandidate = Omit<ExpressionCandidate, "reason">;

function validateSelector(
  context: StrategyContext,
  expression: string,
  expected: bigint
): UnreasonedCandidate | null {
  const parsed = parseSelectorExpression(expression);
  if ("error" in parsed) {
    return null;
  }
  let matched: ReturnType<CheerioAPI>;
  try {
    matched = context.$(parsed.selector);
  } catch {
    return null;
  }
  // The same single-match rule the picker's apply gate enforces, so a
  // suggestion can never be one the user is then refused.
  if (matched.length !== 1) {
    return null;
  }
  const result = extractBySelector({ ...context, expression });
  if (!(result && equalsExpected(result.price, expected))) {
    return null;
  }
  const node = matched.first();
  const raw = parsed.attribute
    ? node.attr(parsed.attribute)
    : (node.attr("content") ?? node.attr("value") ?? node.text());
  return {
    expression,
    mode: "selector",
    sample: {
      context: truncate(context.$.html(node)),
      value: truncate(collapse(raw ?? "")),
    },
    ...(result.currency ? { currency: result.currency } : {}),
  };
}

function validateJsonPath(
  documents: readonly JsonDocument[],
  expression: string,
  expected: bigint,
  locale: string | undefined
): UnreasonedCandidate | null {
  const path = parseJsonPath(expression);
  if ("error" in path) {
    return null;
  }
  const resolved: { source: string; value: unknown }[] = [];
  for (const document of documents) {
    for (const value of evaluateJsonPath(path, document.value)) {
      resolved.push({ source: document.source, value });
    }
  }
  const only = resolved.length === 1 ? resolved[0] : undefined;
  if (!only) {
    return null;
  }
  const parsed = jsonValuePrice(only.value, locale);
  if (!(parsed && equalsExpected(parsed.amount, expected))) {
    return null;
  }
  return {
    expression,
    mode: "jsonpath",
    sample: { context: truncate(only.source), value: truncate(describeJsonValue(only.value)) },
    ...(parsed.currency ? { currency: parsed.currency } : {}),
  };
}

function score(draft: Draft, candidate: UnreasonedCandidate): number {
  let total = draft.tier * TIER_WEIGHT + Math.floor(candidate.expression.length / LENGTH_DIVISOR);
  if (!candidate.currency) {
    total += NO_CURRENCY_PENALTY;
  }
  if (OTHER_PRODUCT_TOKEN.test(draft.neighbourhood)) {
    total += OTHER_PRODUCT_PENALTY;
  }
  if (draft.positional) {
    total += POSITIONAL_PENALTY;
  }
  if (draft.prose) {
    total += PROSE_PENALTY;
  }
  if (draft.struck) {
    total += STRUCK_PENALTY;
  }
  if (draft.weak) {
    total += WEAK_SELECTOR_PENALTY;
  }
  if (STALE_PRICE_TOKEN.test(draft.neighbourhood)) {
    total += STALE_PRICE_PENALTY;
  }
  return total;
}

function listPhrase(parts: readonly string[]): string {
  if (parts.length <= 1) {
    return parts[0] ?? "";
  }
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/**
 * Why this candidate ranked where it did. The caveats are the ones validation
 * cannot settle: a crossed-out price and a sale price are the same number when
 * the page is on offer at the figure the user read somewhere else.
 */
function reasonFor(draft: Draft, candidate: UnreasonedCandidate): string {
  let where = "the price element's text";
  if (draft.mode === "jsonpath") {
    where = "the page's structured data";
  } else if (candidate.expression.includes("::attr(")) {
    where = "an attribute on the price element";
  }

  const caveats: string[] = [];
  if (!candidate.currency) {
    caveats.push("it reads no currency, so this listing needs one configured");
  }
  if (draft.positional) {
    caveats.push(
      draft.mode === "jsonpath"
        ? "it reaches one entry of a list by position, so reordering that list would silently read another price"
        : "its text holds more than one price, so it reads whichever comes first"
    );
  }
  if (draft.prose) {
    caveats.push("its text reads as a sentence rather than a price");
  }
  if (draft.struck) {
    caveats.push("it sits inside struck-through markup, usually the old price");
  }
  if (draft.weak) {
    caveats.push("it has no stable class or id of its own, so a markup change may break it again");
  }
  if (STALE_PRICE_TOKEN.test(draft.neighbourhood)) {
    caveats.push("its surroundings name it as a was-price");
  }
  if (OTHER_PRODUCT_TOKEN.test(draft.neighbourhood)) {
    caveats.push("its surroundings look like another product's price");
  }
  return caveats.length === 0 ? `Reads ${where}.` : `Reads ${where}, but ${listPhrase(caveats)}.`;
}

function automaticVerdict(
  html: string,
  options: SuggestOptions,
  expected: bigint
): AutomaticVerdict | null {
  const result = extract(html, {
    ...(options.locale ? { locale: options.locale } : {}),
    ...(options.url ? { url: options.url } : {}),
  });
  if (!result.ok) {
    return null;
  }
  return {
    agrees: equalsExpected(result.price, expected),
    ambiguous: isAmbiguousExtraction(result),
    price: result.price,
    ...(result.currency ? { currency: result.currency } : {}),
  };
}

function mergeSightings(...groups: readonly PriceSighting[][]): PriceSighting[] {
  const merged: PriceSighting[] = [];
  for (const group of groups) {
    for (const sighting of group) {
      addSighting(merged, sighting);
    }
  }
  return merged;
}

/**
 * Expressions that read `expectedPrice` off this page, ranked most durable
 * first, plus what the automatic chain makes of the same page.
 *
 * Empty `candidates` means the value is not on the page — the price moved, or
 * a different variant was read — and `pricesOnPage` is what to offer instead.
 * Near-misses are deliberately not matched: a tolerance is exactly what lets a
 * delivery threshold or a bundle price win, and a confidently wrong pin is
 * worse than none.
 */
export function suggestExpressions(html: string, options: SuggestOptions): Suggestion {
  const nothing: Suggestion = { automatic: null, candidates: [], pricesOnPage: [] };
  if (html.trim().length === 0) {
    return nothing;
  }
  let expected: bigint;
  try {
    expected = toMinorUnits(options.expectedPrice);
  } catch {
    return nothing;
  }

  const context: StrategyContext = { $: load(html), html };
  if (options.locale !== undefined) {
    context.locale = options.locale;
  }
  if (options.url !== undefined) {
    context.url = options.url;
  }

  // Collected once and shared: re-scanning every inline script per candidate is
  // what makes a naive version of this too slow to run on a keystroke.
  const documents = collectJsonDocuments(context);
  const fromJson = walkJson(documents, expected, options.locale);
  const fromDom = walkDom(context, expected, options.locale);

  const seen = new Set<string>();
  const drafts = [...fromJson.drafts, ...fromDom.drafts]
    .filter((draft) => {
      const key = `${draft.mode}:${draft.expression}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.tier - b.tier)
    .slice(0, MAX_VALIDATIONS);

  const ranked: { candidate: ExpressionCandidate; total: number }[] = [];
  for (const draft of drafts) {
    const validated =
      draft.mode === "jsonpath"
        ? validateJsonPath(documents, draft.expression, expected, options.locale)
        : validateSelector(context, draft.expression, expected);
    if (!validated) {
      continue;
    }
    ranked.push({
      candidate: { ...validated, reason: reasonFor(draft, validated) },
      total: score(draft, validated),
    });
  }
  ranked.sort((a, b) => a.total - b.total);

  return {
    automatic: automaticVerdict(html, options, expected),
    candidates: ranked.slice(0, MAX_CANDIDATES).map((entry) => entry.candidate),
    pricesOnPage: mergeSightings(fromDom.sightings, fromJson.sightings),
  };
}
