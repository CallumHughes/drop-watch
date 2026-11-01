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
/**
 * Money values collected before ranking cuts them to {@link MAX_SIGHTINGS}.
 *
 * Truncating in document order put a basket total, a delivery threshold and a
 * mega-menu promo in the list and left the product's own price out of it —
 * which is the one case the list exists for.
 */
const MAX_COLLECTED_SIGHTINGS = 60;
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
/**
 * Full-document selector queries one call may spend.
 *
 * {@link identifies} scans the whole tree, which on a large page costs around
 * half a millisecond a time, and this runs synchronously in the API handler on
 * every debounced keystroke. The ceiling that matters is the event loop's
 * rather than any single page's, so narrowing stops looking when the budget is
 * gone — the same outcome as finding nothing, which is what it would have
 * found on a page where every selector matches five hundred elements.
 */
const MAX_SELECTOR_QUERIES = 600;
/**
 * And per element, so one element whose every selector is ambiguous cannot
 * spend the whole call's budget before the next one is looked at.
 */
const MAX_SELECTOR_QUERIES_PER_ELEMENT = 48;
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
/** Characters that cannot survive even a quoted attribute selector. */
const UNQUOTABLE = /[\\\n\r]/;
/**
 * A value that is nothing but a number, which on a price element is the price.
 * Baking it into the selector makes the pin break the moment the price moves.
 */
const NUMERIC_VALUE = /^[-\d.,'’\s]+$/;
const MANY_DIGITS = /\d{4,}/;
/** `css-1x2y3z`, `sc-AbCdEf`, `jsx-123` — a build step's output, not a name. */
const GENERATED_PREFIX = /^(?:css|sc|jsx|emotion|svelte|_)-/i;
/** A trailing hash: a separator then a run mixing letters and digits. */
const HASHED_SUFFIX = /[-_](?=[a-z0-9]*\d)(?=[a-z0-9]*[a-z])[a-z0-9]{5,}$/i;
/** Names that say the element holds a price. */
const PRICE_TOKEN = /price|amount|cost|money|total|value/i;
/** Tailwind-shaped utilities: unstable and semantically empty. */
const UTILITY_CLASS =
  /^(?:text|font|bg|p|m|[pm][xytrbl]|w|h|min|max|flex|grid|gap|border|rounded|shadow|leading|tracking|items|justify|inline|block|hidden|absolute|relative|fixed|sticky|top|left|right|bottom|z|opacity|space|overflow|whitespace|align|order|col|row|gradient|from|to|via|sm|md|lg|xl|2xl)(?:-|$)/;
/** Attributes worth reading explicitly, most machine-readable first. */
const ATTRIBUTE_PREFERENCE = ["content", "data-price", "data-product-price", "value"] as const;
/**
 * Attributes that identify an element without describing its looks.
 *
 * `property` and `name` are here for `<meta property="product:price:amount">`,
 * which is among the most stable places a price lives and has no usable
 * ancestor to be narrowed against — without them it is found and then
 * discarded.
 */
const IDENTIFYING_ATTRIBUTES = [
  "itemprop",
  "data-testid",
  "data-test",
  "data-qa",
  "data-price",
  "property",
  "name",
];

/** `element.attribs` as it actually behaves: any name may simply be absent. */
type Attributes = Partial<Record<string, string>>;

/** Full-document queries left: `queries` for the call, `element` for this one. */
interface SelectorBudget {
  element: number;
  queries: number;
}

export interface PriceSighting {
  /** Decimal string, as `parsePrice` produced it. */
  amount: string;
  /** Where it was seen, so the reader can tell two equal prices apart. */
  context: string;
  currency?: string;
}

/** A sighting and how likely it is to be the price being sold. Lower is better. */
interface RankedSighting extends PriceSighting {
  rank: number;
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
  /**
   * The currency this listing already records, if any.
   *
   * It decides how badly a currency-less candidate ranks: with one on file the
   * worker accepts a bare number, and without one that pin is an
   * `extract_failed` on the very next check.
   */
  listingCurrency?: string;
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

/** `originalPrice` → `original price`, so a JSON key reads like a class name. */
const CAMEL_BOUNDARY = /([a-z\d])([A-Z])/g;
/** Everything between one word of a name and the next, once lowercased. */
const NAME_SEPARATORS = /[^a-z\d]+/;

/**
 * The words a name is made of, lowercased.
 *
 * Whole words, because every token below is a substring of some perfectly
 * ordinary class name: `old` sits in `font-bold`, `list` in `product-listing`,
 * `before` in Tailwind's `before:` variants. Testing the raw attribute put a
 * was-price penalty — and a reason line announcing one — on the real price of
 * any page styled with utilities.
 */
function nameWords(value: string): string[] {
  return value
    .replace(CAMEL_BOUNDARY, "$1 $2")
    .toLowerCase()
    .split(NAME_SEPARATORS)
    .filter((word) => word.length > 0);
}

/** Words that say a name holds a price. */
const PRICE_WORDS = new Set([
  "amount",
  "amounts",
  "cost",
  "fee",
  "money",
  "price",
  "prices",
  "pricing",
  "rate",
  "subtotal",
  "total",
  "value",
]);
/**
 * Words that say a name holds a *different* price on the right product — the
 * crossed-out one. Validation cannot catch these: they parse to the same
 * number when the page is on offer at the figure the user read elsewhere.
 */
const STALE_PRICE_WORDS = new Set([
  "compare",
  "compareat",
  "crossed",
  "msrp",
  "rrp",
  "slashed",
  "strike",
  "strikethrough",
  "struck",
  "was",
  "wasprice",
]);
/** The same, for words that mean nothing on their own — see {@link namesCarry}. */
const WEAK_STALE_PRICE_WORDS = new Set([
  "before",
  "full",
  "list",
  "old",
  "original",
  "previous",
  "regular",
  "retail",
]);
/** Words that say a name holds the right price for the *wrong* product. */
const OTHER_PRODUCT_WORDS = new Set([
  "alsobought",
  "alsoviewed",
  "bundle",
  "bundled",
  "bundles",
  "carousel",
  "crosssell",
  "crosssells",
  "recent",
  "recently",
  "recommend",
  "recommendation",
  "recommendations",
  "recommended",
  "related",
  "similar",
  "suggested",
  "suggestions",
  "upsell",
  "upsells",
  "youmayalsolike",
  "youmaylike",
]);
const WEAK_OTHER_PRODUCT_WORDS = new Set(["also", "more", "other", "suggest"]);
/**
 * What a weak other-product word needs beside it.
 *
 * `price` cannot do that job here: the whole phrase is `also bought`, and the
 * second half lands in a class of its own. These words are safe to read across
 * an element's classes because none of them is price-element vocabulary.
 */
const OTHER_PRODUCT_COMPANIONS = new Set([
  "bought",
  "items",
  "like",
  "liked",
  "picks",
  "products",
  "sellers",
  "viewed",
]);

/** A vocabulary, and what its half-words need beside them to count. */
interface WordSignal {
  /**
   * Whether a corroborating word may come from another of the element's names.
   *
   * False for a was-price, whose corroborator is `price` and therefore sits on
   * half the price elements on the web — `w-full product-price` is not an old
   * price. True where the corroborators are a vocabulary that never turns up
   * on a price element by itself, so `class="also bought"` can still be read.
   */
  acrossNames: boolean;
  corroborators: ReadonlySet<string>;
  /** Words that say it only alongside a corroborator. */
  weak: ReadonlySet<string>;
  /** Words that say it on their own. */
  words: ReadonlySet<string>;
}

const STALE_PRICE_SIGNAL: WordSignal = {
  acrossNames: false,
  corroborators: PRICE_WORDS,
  weak: WEAK_STALE_PRICE_WORDS,
  words: STALE_PRICE_WORDS,
};
const OTHER_PRODUCT_SIGNAL: WordSignal = {
  acrossNames: true,
  corroborators: OTHER_PRODUCT_COMPANIONS,
  weak: WEAK_OTHER_PRODUCT_WORDS,
  words: OTHER_PRODUCT_WORDS,
};

function carriesAny(words: Iterable<string>, set: ReadonlySet<string>): boolean {
  for (const word of words) {
    if (set.has(word)) {
      return true;
    }
  }
  return false;
}

/**
 * Whether any of these names carries one of `signal`'s words.
 *
 * Each name is read word by word and also whole with its separators removed,
 * so `cross-sell` matches `crosssell`. One name means one class or one id,
 * never a whole attribute — see {@link elementNames} for why that distinction
 * is the whole point, and {@link WordSignal.acrossNames} for the one place it
 * is deliberately relaxed.
 */
function namesCarry(names: readonly string[], signal: WordSignal): boolean {
  const everyWord = signal.acrossNames ? names.flatMap((name) => nameWords(name)) : null;
  for (const name of names) {
    const found = nameWords(name);
    if (signal.words.has(found.join("")) || carriesAny(found, signal.words)) {
      return true;
    }
    if (carriesAny(found, signal.weak) && carriesAny(everyWord ?? found, signal.corroborators)) {
      return true;
    }
  }
  return false;
}

function namesAreStale(names: readonly string[]): boolean {
  return namesCarry(names, STALE_PRICE_SIGNAL);
}

function namesAreOtherProduct(names: readonly string[]): boolean {
  return namesCarry(names, OTHER_PRODUCT_SIGNAL);
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

/**
 * The same judgement for a *quoted* attribute value, which may legitimately
 * hold what a CSS identifier may not — `product:price:amount` is the most
 * stable place a price lives. Only the quoting characters have to go, plus any
 * value that reads as money.
 *
 * That last one is the point: `[data-price="£24.99"]` identifies the element
 * today and matches nothing the moment the price moves, so the watch breaks on
 * precisely the change it exists to catch. Asking `parsePrice` rather than
 * testing for a bare number catches `£24.99` and `24.99 GBP` too, and it is
 * the right way round to be wrong — a rejected value costs one candidate,
 * while an accepted one costs the watch.
 */
function looksGeneratedValue(value: string): boolean {
  return (
    value.length > 60 ||
    GENERATED_PREFIX.test(value) ||
    HASHED_SUFFIX.test(value) ||
    MANY_DIGITS.test(value) ||
    NUMERIC_VALUE.test(value) ||
    QUOTES.test(value) ||
    UNQUOTABLE.test(value) ||
    parsePrice(value) !== null
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
    if (value && !looksGeneratedValue(value)) {
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

/** Whether `selector` reaches this element and nothing else, document-wide. */
function identifies(
  $: CheerioAPI,
  selector: string,
  element: CheerioElement,
  budget: SelectorBudget
): boolean {
  if (budget.queries <= 0 || budget.element <= 0) {
    return false;
  }
  budget.queries -= 1;
  budget.element -= 1;
  try {
    const matched = $(selector);
    return matched.length === 1 && matched.get(0) === element;
  } catch {
    return false;
  }
}

/**
 * The same question asked inside one subtree, which costs nothing like a
 * document-wide scan and so is not charged to the budget.
 */
function identifiesWithin(
  scope: ReturnType<CheerioAPI>,
  selector: string,
  element: CheerioElement
): boolean {
  try {
    const found = scope.find(selector);
    return found.length === 1 && found.get(0) === element;
  } catch {
    return false;
  }
}

/**
 * The selector one ancestor's prefixes give for this element, or null.
 *
 * A prefix is tested once rather than once per pair. When it names its
 * ancestor uniquely, `prefix own` is by definition the ancestor's descendants
 * matching `own`, so the rest of the search is a subtree query instead of
 * prefixes × own scans of the whole page. A prefix that is *not* unique still
 * has to be asked the long way, because `.row .figure` can be unique when
 * neither half is — and that is the case the budget exists for.
 */
function narrowedUnder(
  $: CheerioAPI,
  ancestor: CheerioElement,
  element: CheerioElement,
  own: readonly SelfSelector[],
  budget: SelectorBudget
): SelfSelector | null {
  const scope = $(ancestor);
  for (const prefix of selfSelectors(ancestor)) {
    if (prefix.weak) {
      continue;
    }
    const scoped = identifies($, prefix.selector, ancestor, budget);
    for (const entry of own) {
      const matched = scoped
        ? identifiesWithin(scope, entry.selector, element)
        : identifies($, `${prefix.selector} ${entry.selector}`, element, budget);
      if (matched) {
        return { selector: `${prefix.selector} ${entry.selector}`, weak: entry.weak };
      }
    }
  }
  return null;
}

/**
 * The shortest selector that reaches this element and nothing else.
 *
 * Ancestors are prepended with the descendant combinator rather than `>` —
 * a store inserting one more wrapper div should not break the watch — and the
 * walk stops at {@link MAX_SELECTOR_DEPTH}. Positional selectors are never
 * emitted at all: `:nth-child(3)` is the expression that breaks next week.
 *
 * Returns null once the budget is spent, which is the same outcome as finding
 * nothing: no candidate, rather than a slow one.
 */
function narrowedSelector(
  $: CheerioAPI,
  element: CheerioElement,
  budget: SelectorBudget
): SelfSelector | null {
  const own = selfSelectors(element);
  for (const entry of own) {
    if (!entry.weak && identifies($, entry.selector, element, budget)) {
      return entry;
    }
  }

  let ancestor = parentElement($, element);
  for (let depth = 0; depth < MAX_SELECTOR_DEPTH && ancestor; depth += 1) {
    const under = narrowedUnder($, ancestor, element, own, budget);
    if (under) {
      return under;
    }
    ancestor = parentElement($, ancestor);
  }
  return null;
}

/**
 * The names this element goes by: one entry per class, id or microdata token.
 *
 * Split this finely because {@link namesCarry} looks for its corroborating
 * price word *within* a name, and one name has to mean one thing. A whole
 * `class` attribute does not: `class="w-full product-price"` yields `full` from
 * one class and `price` from another, which read together say was-price — and
 * `w-full` is on half the price elements on the web. The cost is that a
 * was-price spelled across two classes, `class="old price"`, is no longer read
 * as one; `old-price` and `price--old` still are, and the strong words need no
 * corroboration at all.
 */
function elementNames(element: CheerioElement): string[] {
  const attributes: Attributes = "attribs" in element ? element.attribs : {};
  const names: string[] = [];
  for (const value of [attributes.class, attributes.id, attributes.itemprop]) {
    if (value) {
      names.push(...value.split(COLLAPSE_WHITESPACE).filter((token) => token.length > 0));
    }
  }
  return names;
}

/** Where an element sits, for the reason line and the demotion rules. */
function ancestryNames($: CheerioAPI, element: CheerioElement): string[] {
  const names: string[] = [];
  let current: CheerioElement | null = element;
  for (let depth = 0; depth <= MAX_ANCESTOR_DEPTH && current; depth += 1) {
    names.push(...elementNames(current));
    current = parentElement($, current);
  }
  return names;
}

/** A candidate expression before it has been run against the page. */
interface Draft {
  expression: string;
  mode: ExpressionMode;
  /** The names around the match, read by the demotion rules and the reason. */
  names: string[];
  /** The text holds more than one price, so the match depends on their order. */
  positional: boolean;
  /** The matched text reads as a sentence, not a price. */
  prose: boolean;
  /** Inside `<del>`, `<s>` or `<strike>` — the page's own "not this price". */
  struck: boolean;
  /** Durability tier: structured data, explicit attribute, then element text. */
  tier: 0 | 1 | 2;
  /** Nothing about the field it reads says it holds a price. */
  unnamed: boolean;
  /** Identified only by its ancestors and tag. */
  weak: boolean;
  /** Contains the element that holds the price, so a tighter pin exists. */
  wrapper: boolean;
}

interface Walked {
  drafts: Draft[];
  sightings: RankedSighting[];
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

function addSighting(sightings: RankedSighting[], sighting: RankedSighting): void {
  const key = `${sighting.amount}|${sighting.currency ?? ""}`;
  const seen = sightings.some((entry) => `${entry.amount}|${entry.currency ?? ""}` === key);
  if (!seen && sightings.length < MAX_COLLECTED_SIGHTINGS) {
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
 * Whether a descendant element also reads this price, so a tighter pin exists.
 *
 * An ancestor whose whole text is just the price validates exactly as the
 * price element does — `<div class="price-block"><span class="product-price">`
 * is the commonest markup there is — and with nothing to separate them,
 * document order decides, which picks the outermost: the least durable of the
 * set. `.price-block` reads £24.99 today and reads a "Save £5" badge the day
 * one is inserted before the price. The `.product-price` inside it cannot.
 *
 * Only a demotion, never a refusal: the wrapper is the right answer when the
 * element inside holds a bare number and the wrapper carries the currency.
 * That contest is decided against {@link BARE_NUMBER_PENALTY}, not
 * {@link NO_CURRENCY_PENALTY} — it only arises once the listing has a currency
 * on file — so this penalty has to stay below 600, not below 2,200.
 */
function wrapsAPriceElement(
  $: CheerioAPI,
  element: CheerioElement,
  expected: bigint,
  locale: string | undefined
): boolean {
  for (const descendant of $(element).find("*").toArray()) {
    if (!("tagName" in descendant) || SKIPPED_TAGS.has(descendant.tagName)) {
      continue;
    }
    const text = collapse($(descendant).text());
    if (text.length === 0 || text.length > MAX_PRICE_TEXT_CHARS) {
      continue;
    }
    const parsed = parsePrice(text, { ...(locale ? { locale } : {}) });
    if (parsed && equalsExpected(parsed.amount, expected)) {
      return true;
    }
  }
  return false;
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
  expected: bigint,
  locale: string | undefined,
  budget: SelectorBudget
): Draft | null {
  const selector = narrowedSelector($, element, budget);
  if (!selector) {
    return null;
  }
  return {
    expression: selector.selector,
    mode: "selector",
    names: ancestryNames($, element),
    positional: distinctPrices(text, locale) > 1,
    prose: (text.match(LETTERS)?.length ?? 0) > MAX_PRICE_TEXT_LETTERS,
    struck: isStruck($, element),
    tier: 2,
    unnamed: false,
    weak: selector.weak,
    wrapper: wrapsAPriceElement($, element, expected, locale),
  };
}

/** An attribute worth reading, and the value it holds. */
interface PriceAttribute {
  name: string;
  value: string;
}

function priceAttributes(
  attributes: Attributes,
  expected: bigint,
  locale: string | undefined
): PriceAttribute[] {
  const found: PriceAttribute[] = [];
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
      found.push({ name, value });
    }
  }
  return found;
}

/** Attributes whose value names what an element is, for {@link attributeSaysPrice}. */
const PRICE_NAMING_ATTRIBUTES = ["class", "id", "itemprop", "property", "name"];
/**
 * The narrower set that can speak for a `value` attribute.
 *
 * `content` has no job but to carry metadata, so a class naming the element a
 * price is enough to say what its `content` holds. `value` is the live value
 * of a form control — a selected variant, a quantity — and a class on the
 * control says what the control is *about*, not that its value is the price.
 * `<input class="price" name="qty" value="499">` is the shape that matters: on
 * a page selling at £499 the quantity field reads as the price, and the pin is
 * an expression that says `qty`. Only an explicit annotation settles it.
 */
const VALUE_NAMING_ATTRIBUTES = ["itemprop", "property"];

/**
 * Words that say an *attribute name* holds a price.
 *
 * Narrower than {@link PRICE_WORDS} on purpose. `value`, `total` and `rate`
 * name a price when they are a class or a JSON key, but as attribute names
 * they are the generic slots every form control and widget has, and
 * `data-value="499"` says nothing about money.
 */
const PRICE_ATTRIBUTE_WORDS = new Set([
  "amount",
  "amounts",
  "cost",
  "fee",
  "money",
  "price",
  "prices",
  "pricing",
]);

/**
 * Whether an attribute worth reading says it holds a *price*.
 *
 * `data-product-id="499"` parses to 499 on a page selling something for £499,
 * and it will still read 499 after the price moves — the silent wrong reading
 * the `unnamed` flag exists for, and the one the JSON side already refuses.
 *
 * `content` and `value` are asked first, because `value` is itself a price
 * word: testing the name first answered for it and the element-level test —
 * the only thing that can speak for those two — never ran, so an
 * `<option value="499">` or a hidden `<input name="product_id" value="499">`
 * passed as a price. They are asked differently, too: see
 * {@link VALUE_NAMING_ATTRIBUTES}. Everything else is settled by its own name,
 * which is what makes `<meta itemprop="price" content="24.99">` the shape it
 * is.
 */
function attributeSaysPrice(attributes: Attributes, name: string): boolean {
  if (name === "content" || name === "value") {
    const naming = name === "value" ? VALUE_NAMING_ATTRIBUTES : PRICE_NAMING_ATTRIBUTES;
    return naming.some((attribute) => {
      const value = attributes[attribute];
      return Boolean(value) && carriesAny(nameWords(value as string), PRICE_WORDS);
    });
  }
  return carriesAny(nameWords(name), PRICE_ATTRIBUTE_WORDS);
}

function attributeDraft(
  $: CheerioAPI,
  element: CheerioElement,
  attribute: PriceAttribute,
  locale: string | undefined,
  budget: SelectorBudget
): Draft | null {
  const selector = narrowedSelector($, element, budget);
  if (!selector) {
    return null;
  }
  const { name, value } = attribute;
  // `content` and `value` are already read ahead of text by
  // `extractBySelector`, so naming them again only adds a moving part.
  const implicit = name === "content" || name === "value";
  return {
    expression: implicit ? selector.selector : `${selector.selector}::attr(${name})`,
    mode: "selector",
    names: [name, ...ancestryNames($, element)],
    // An attribute value is read exactly as element text is, so it earns the
    // same caveats: `<meta name="description" content="Buy it for £24.99">`
    // parses to the price and is a sentence about the product, not its price.
    positional: distinctPrices(value, locale) > 1,
    prose: (value.match(LETTERS)?.length ?? 0) > MAX_PRICE_TEXT_LETTERS,
    struck: isStruck($, element),
    tier: 1,
    unnamed: !attributeSaysPrice("attribs" in element ? element.attribs : {}, name),
    weak: selector.weak,
    // The attribute is on this element; what its descendants hold is not read.
    wrapper: false,
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
  element: CheerioElement,
  text: string,
  parsed: ParsedPrice | null,
  priceNamed: boolean,
  sightings: RankedSighting[]
): void {
  const holdsOnePrice = node.children().length === 0 || priceNamed;
  if (!(parsed && holdsOnePrice && (parsed.currency || priceNamed))) {
    return;
  }
  // Only computed for a value that is actually going in the list, because the
  // walk reaches every element on the page and most contribute nothing.
  const names = elementNames(element);
  addSighting(sightings, {
    amount: parsed.amount,
    context: truncate(text, MAX_PRICE_TEXT_CHARS),
    rank: (priceNamed ? 0 : 2) + (namesAreOtherProduct(names) ? 1 : 0),
    ...(parsed.currency ? { currency: parsed.currency } : {}),
  });
}

/** Everything one element contributes, and how many selectors it cost. */
function inspectElement(
  $: CheerioAPI,
  element: CheerioElement,
  expected: bigint,
  locale: string | undefined,
  out: Walked,
  budget: SelectorBudget
): number {
  if (!("tagName" in element) || SKIPPED_TAGS.has(element.tagName)) {
    return 0;
  }
  const node = $(element);
  // Once per element, not once per narrowing: an element with three
  // price-bearing attributes and matching text attempts it four times, and
  // resetting the allowance each time let one element spend most of the call's.
  budget.element = MAX_SELECTOR_QUERIES_PER_ELEMENT;
  const attributes: Attributes = element.attribs;
  const priceNamed = isPriceNamed(attributes);
  const text = collapse(node.text());
  const parsed =
    text.length > 0 && text.length <= MAX_PRICE_TEXT_CHARS
      ? parsePrice(text, { ...(locale ? { locale } : {}) })
      : null;

  recordSighting(node, element, text, parsed, priceNamed, out.sightings);

  let synthesised = 0;
  // Attributes first: an element whose `content` holds the price and whose
  // text also reads it yields the same bare selector twice, and the attribute
  // is what `extractBySelector` actually reads. The dedupe below keeps the
  // lower tier either way; this keeps the two in the order they are read.
  for (const attribute of priceAttributes(attributes, expected, locale)) {
    synthesised += 1;
    const draft = attributeDraft($, element, attribute, locale, budget);
    if (draft) {
      out.drafts.push(draft);
    }
  }
  if (parsed && equalsExpected(parsed.amount, expected)) {
    synthesised += 1;
    const draft = textDraft($, element, text, expected, locale, budget);
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
  const budget: SelectorBudget = {
    element: MAX_SELECTOR_QUERIES_PER_ELEMENT,
    queries: MAX_SELECTOR_QUERIES,
  };
  let synthesised = 0;

  for (const element of $("*").toArray().slice(0, MAX_ELEMENTS)) {
    if (synthesised >= MAX_SYNTHESISED) {
      break;
    }
    synthesised += inspectElement($, element, expected, locale, out, budget);
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

/** The names a JSON path goes by: the document, then each key, kept apart. */
function pathNames(path: readonly (string | number)[], source: string): string[] {
  return [source, ...path.map((segment) => String(segment))];
}

/**
 * Price words strong enough to name a key's *descendants* as well as itself.
 *
 * `value` and `total` are not among them: `initialValue`, `totals` and
 * `pageValue` wrap whole payloads in app state, and letting one of those name
 * everything beneath it puts `{ "stock": 499 }` back in the structured-data
 * tier as soon as the payload is nested a level down.
 */
const STRONG_PRICE_WORDS = new Set(["cost", "fee", "price", "prices", "pricing"]);

/**
 * How the keys on a path speak for the number at the end of it.
 *
 * Two answers rather than one, because the two expressions {@link pathDrafts}
 * emits carry different parts of the path. `$..current` carries only the leaf;
 * what made `priceInfo.current` a price is a key the shorthand throws away.
 */
interface PathNaming {
  /** The leaf alone says price, which is all `$..leaf` can claim. */
  leaf: boolean;
  /** Some key on the path says price, which the concrete path spells out. */
  path: boolean;
}

/**
 * Whether the field a scalar sits in says it holds a price.
 *
 * Not the leaf alone: `priceInfo.current` is as plainly a price as
 * `product.price`, and reading `current` by itself called it some number that
 * happened to match. A parent has to say it strongly, though — see
 * {@link STRONG_PRICE_WORDS}. `{ "stock": 499 }` on a page showing `£499` is
 * named by nothing either way, which is the case this exists for: without it
 * `$..stock` is the most durable candidate on the page and the pin reads the
 * stock count from then on.
 */
function pathNaming(path: readonly (string | number)[]): PathNaming {
  const last = path.at(-1);
  const leaf = typeof last === "string" && carriesAny(nameWords(last), PRICE_WORDS);
  if (leaf) {
    return { leaf, path: true };
  }
  const named = path.some(
    (segment) => typeof segment === "string" && carriesAny(nameWords(segment), STRONG_PRICE_WORDS)
  );
  return { leaf, path: named };
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
function pathDrafts(
  path: readonly (string | number)[],
  source: string,
  drafts: Draft[],
  naming: PathNaming
): void {
  const names = pathNames(path, source);
  const last = path.at(-1);
  if (typeof last === "string" && JSON_NAME.test(last)) {
    drafts.push({
      expression: `$..${last}`,
      mode: "jsonpath",
      names,
      positional: false,
      prose: false,
      struck: false,
      tier: 0,
      // Only what the leaf says, because the leaf is all this expression has.
      unnamed: !naming.leaf,
      weak: false,
      wrapper: false,
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
    names,
    positional: indexed,
    prose: false,
    struck: false,
    tier: indexed ? 2 : 0,
    unnamed: !naming.path,
    weak: false,
    wrapper: false,
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
    // failure unless the listing already learned one. Its own `price` key is
    // what made it offer-shaped, so it is named by construction.
    const offer = jsonValuePrice(value, locale);
    if (offer?.currency && equalsExpected(offer.amount, expected)) {
      // Named by its shape rather than its key: `jsonValuePrice` only read it
      // because it carries its own `price` and `priceCurrency`.
      pathDrafts(path, source, out.drafts, { leaf: true, path: true });
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
  const naming = pathNaming(path);
  if (naming.path) {
    addSighting(out.sightings, {
      amount: parsed.amount,
      context: `${source} ${path.join(".")}`,
      rank: namesAreOtherProduct(pathNames(path, source)) ? 1 : 0,
      ...(parsed.currency ? { currency: parsed.currency } : {}),
    });
  }
  if (equalsExpected(parsed.amount, expected)) {
    pathDrafts(path, source, out.drafts, naming);
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

/** Durability of a candidate's *shape*: structured data, attribute, then text. */
const TIER_WEIGHT = 1000;
/**
 * Every penalty below outweighs a tier, and most outweigh two.
 *
 * A tier says how well a candidate's shape will survive the page being
 * rebuilt. A penalty says it reads the wrong number, or no number the worker
 * will accept — which no amount of durability redeems. A bare `price` in an
 * embedded blob is the most durable thing this engine can produce and must
 * still lose to the markup that carries a currency when the listing has none,
 * because that pin is an `extract_failed` on the very next check.
 */
const STALE_PRICE_PENALTY = 2600;
const UNNAMED_FIELD_PENALTY = 2600;
const OTHER_PRODUCT_PENALTY = 2500;
const STRUCK_PENALTY = 2400;
const PROSE_PENALTY = 2300;
/** No currency anywhere: on the candidate, and none on file for the listing. */
const NO_CURRENCY_PENALTY = 2200;
/**
 * The listing already has one, so a bare number still checks out — but reading
 * the currency off the page beats trusting what was stored, because a page that
 * switches currency would otherwise go on being recorded in the old one. Above
 * {@link WRAPPER_PENALTY}, so the wrapper that carries `£` is still preferred
 * to the bare number inside it, and well under a tier, so a durable path is
 * not displaced by markup over the currency alone.
 */
const BARE_NUMBER_PENALTY = 600;
/** Which of several prices this reads depends on their order in the markup. */
const POSITIONAL_PENALTY = 1500;
/** Identified only by its ancestors and tag, so a markup change can move it. */
const WEAK_SELECTOR_PENALTY = 500;
/**
 * It contains the price element rather than being it. Enough to settle what
 * document order was settling arbitrarily, and nowhere near enough to lose to
 * the bare number inside it.
 */
const WRAPPER_PENALTY = 400;
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

function score(
  draft: Draft,
  candidate: UnreasonedCandidate,
  listingCurrency: string | undefined
): number {
  let total = draft.tier * TIER_WEIGHT + Math.floor(candidate.expression.length / LENGTH_DIVISOR);
  if (!candidate.currency) {
    total += listingCurrency ? BARE_NUMBER_PENALTY : NO_CURRENCY_PENALTY;
  }
  if (draft.unnamed) {
    total += UNNAMED_FIELD_PENALTY;
  }
  if (namesAreOtherProduct(draft.names)) {
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
  if (draft.wrapper) {
    total += WRAPPER_PENALTY;
  }
  if (namesAreStale(draft.names)) {
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
function reasonFor(
  draft: Draft,
  candidate: UnreasonedCandidate,
  listingCurrency: string | undefined
): string {
  let where = "the price element's text";
  if (draft.mode === "jsonpath") {
    where = "the page's structured data";
  } else if (draft.tier === 1) {
    where = "an attribute on the price element";
  }

  const caveats: string[] = [];
  if (!(candidate.currency || listingCurrency)) {
    caveats.push("it reads no currency, so this listing needs one configured");
  }
  if (draft.unnamed) {
    caveats.push(
      "nothing about the field it reads says it holds a price, so it may be some other number that matches today"
    );
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
  if (draft.wrapper) {
    // Deliberately only about this element: a descendant holding the price has
    // not necessarily yielded a candidate of its own, so promising a tighter
    // pin would send the reader looking for one that is not on offer.
    caveats.push(
      "it contains the price rather than being it, so anything inserted above the price inside it would be read instead"
    );
  }
  if (namesAreStale(draft.names)) {
    caveats.push("its surroundings name it as a was-price");
  }
  if (namesAreOtherProduct(draft.names)) {
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

/**
 * The page's own prices, best guesses first.
 *
 * Ranked before truncating rather than after: a storefront's basket total and
 * delivery threshold come first in document order, and the product's own price
 * is the one value this list exists to offer.
 */
function mergeSightings(...groups: readonly RankedSighting[][]): PriceSighting[] {
  const merged: RankedSighting[] = [];
  for (const group of groups) {
    for (const sighting of group) {
      addSighting(merged, sighting);
    }
  }
  return merged
    .sort((a, b) => a.rank - b.rank)
    .slice(0, MAX_SIGHTINGS)
    .map(({ rank: _rank, ...sighting }) => sighting);
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

  // One draft per expression, keeping the lower tier. The same bare selector
  // arrives twice for an element whose `content` attribute and whose text both
  // read the price, and the attribute draft is the one that describes what
  // `extractBySelector` will do with it.
  const byExpression = new Map<string, Draft>();
  for (const draft of [...fromJson.drafts, ...fromDom.drafts]) {
    const key = `${draft.mode}:${draft.expression}`;
    const kept = byExpression.get(key);
    if (!kept || draft.tier < kept.tier) {
      byExpression.set(key, draft);
    }
  }
  const drafts = [...byExpression.values()]
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
      candidate: { ...validated, reason: reasonFor(draft, validated, options.listingCurrency) },
      total: score(draft, validated, options.listingCurrency),
    });
  }
  ranked.sort((a, b) => a.total - b.total);

  return {
    automatic: automaticVerdict(html, options, expected),
    candidates: ranked.slice(0, MAX_CANDIDATES).map((entry) => entry.candidate),
    pricesOnPage: mergeSightings(fromDom.sightings, fromJson.sightings),
  };
}
