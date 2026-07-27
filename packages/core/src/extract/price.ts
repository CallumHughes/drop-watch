/**
 * Locale-aware price parsing.
 *
 * Locale ambiguity is the main correctness trap in this app: `1,234` is either
 * 1234 or 1.234 depending on where the page was written. The rules here are
 * settled (see PLAN.md §4):
 *
 * - If both `.` and `,` appear, the rightmost one is the decimal separator.
 * - If only one appears and exactly three digits follow it, it is a thousands
 *   separator — unless an explicit `locale` override says otherwise.
 * - Non-breaking / narrow / thin spaces and apostrophes are grouping separators.
 * - Currency comes from the caller (JSON-LD `priceCurrency`) when present, and
 *   from symbol detection otherwise.
 *
 * Results are decimal strings. A price is never turned into a JS float.
 */

/** Digits that follow a lone separator for it to be read as a thousands group. */
const GROUP_DIGIT_COUNT = 3;

/** Unicode spaces used as grouping separators (NBSP, narrow NBSP, thin, ideographic). */
const SPACE_LIKE = /[\u00A0\u2000-\u200B\u202F\u3000]/g;

/** A run of digits plus anything that can legally separate them. */
const NUMBER_RUN = /-?\d[\d\s.,'’]*/;

/** Trailing separators swept up by NUMBER_RUN, e.g. the space in "1 234,56 kr". */
const TRAILING_SEPARATORS = /[\s.,'’]+$/;

const NON_DIGITS = /\D/g;
const LEADING_ZEROS = /^0+(?=\d)/;
const PLAIN_DECIMAL = /^-?\d+(?:\.\d+)?$/;
const ISO_CODE_CANDIDATE = /(?<![A-Za-z])([A-Za-z]{3})(?![A-Za-z])/g;
const THREE_LETTERS = /^[A-Z]{3}$/;
const SINGLE_DIGIT = /\d/;

/**
 * ISO 4217 codes we recognise when a page writes the code rather than a symbol.
 * Deliberately a fixed set — matching any three letters turns "ADD TO CART"
 * into a currency.
 */
const KNOWN_CURRENCY_CODES: ReadonlySet<string> = new Set([
  "AUD",
  "BRL",
  "CAD",
  "CHF",
  "CNY",
  "CZK",
  "DKK",
  "EUR",
  "GBP",
  "HKD",
  "HUF",
  "ILS",
  "INR",
  "ISK",
  "JPY",
  "KRW",
  "MXN",
  "NOK",
  "NZD",
  "PLN",
  "RON",
  "RUB",
  "SEK",
  "SGD",
  "TRY",
  "USD",
  "ZAR",
]);

/**
 * Symbol → ISO code. Order matters: longer, more specific prefixes first so
 * "R$" wins over "$". Genuinely ambiguous symbols are omitted rather than
 * guessed — "kr" is SEK, NOK, DKK or ISK and we would be wrong three times in
 * four. "$" and "¥" are resolved to their dominant meaning.
 */
const CURRENCY_SYMBOLS: ReadonlyArray<readonly [string, string]> = [
  ["US$", "USD"],
  ["NZ$", "NZD"],
  ["HK$", "HKD"],
  ["R$", "BRL"],
  ["C$", "CAD"],
  ["A$", "AUD"],
  ["S$", "SGD"],
  ["£", "GBP"],
  ["€", "EUR"],
  ["¥", "JPY"],
  ["₹", "INR"],
  ["₩", "KRW"],
  ["₽", "RUB"],
  ["₪", "ILS"],
  ["₺", "TRY"],
  ["zł", "PLN"],
  ["Kč", "CZK"],
  ["Ft", "HUF"],
  ["$", "USD"],
];

export interface ParsedPrice {
  /** Decimal string, e.g. "1234.56". Never a float. */
  amount: string;
  /** ISO 4217 code when it could be determined. */
  currency?: string;
}

export interface ParsePriceOptions {
  /** Currency hint that wins over symbol detection (e.g. JSON-LD priceCurrency). */
  currency?: string;
  /** BCP 47 tag disambiguating a lone separator, e.g. "de-DE". */
  locale?: string;
}

interface LocaleSeparators {
  decimal: string;
  group: string;
}

/** Replaces exotic spaces with plain ones so one rule covers all of them. */
function normalizeSpaces(input: string): string {
  return input.replace(SPACE_LIKE, " ");
}

function localeSeparators(locale: string): LocaleSeparators | null {
  try {
    const parts = new Intl.NumberFormat(locale).formatToParts(12_345.6);
    const decimal = parts.find((part) => part.type === "decimal")?.value;
    const group = parts.find((part) => part.type === "group")?.value;
    if (!(decimal && group)) {
      return null;
    }
    return { decimal, group };
  } catch {
    return null;
  }
}

/** Normalises a caller-supplied currency: an ISO code, or a symbol we know. */
export function normalizeCurrency(input: string | undefined): string | undefined {
  if (!input) {
    return;
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return;
  }
  const upper = trimmed.toUpperCase();
  if (THREE_LETTERS.test(upper)) {
    return upper;
  }
  for (const [symbol, code] of CURRENCY_SYMBOLS) {
    if (trimmed.includes(symbol)) {
      return code;
    }
  }
}

/** Finds a currency in free text: an ISO code first, then a known symbol. */
export function detectCurrency(input: string): string | undefined {
  for (const match of input.matchAll(ISO_CODE_CANDIDATE)) {
    const code = match[1]?.toUpperCase();
    if (code && KNOWN_CURRENCY_CODES.has(code)) {
      return code;
    }
  }
  for (const [symbol, code] of CURRENCY_SYMBOLS) {
    if (input.includes(symbol)) {
      return code;
    }
  }
}

function digitsAfter(token: string, index: number): number {
  let count = 0;
  for (let i = index + 1; i < token.length; i += 1) {
    if (SINGLE_DIGIT.test(token.charAt(i))) {
      count += 1;
    }
  }
  return count;
}

function occurrences(token: string, separator: string): number {
  let count = 0;
  for (const char of token) {
    if (char === separator) {
      count += 1;
    }
  }
  return count;
}

/**
 * Decides which character in a numeric token is the decimal point, or null when
 * every separator present is a thousands group.
 */
function resolveDecimalSeparator(token: string, locale: string | undefined): string | null {
  const dots = occurrences(token, ".");
  const commas = occurrences(token, ",");

  if (dots > 0 && commas > 0) {
    // Rightmost wins: "1.234,56" is 1234.56, "1,234.56" is also 1234.56.
    return token.lastIndexOf(".") > token.lastIndexOf(",") ? "." : ",";
  }
  // Repeated separators can only be grouping: "1.234.567".
  if (dots > 1 || commas > 1) {
    return null;
  }

  let separator: string | null = null;
  if (dots === 1) {
    separator = ".";
  } else if (commas === 1) {
    separator = ",";
  }
  if (!separator) {
    return null;
  }

  const separators = locale ? localeSeparators(locale) : null;
  if (separators) {
    return separator === separators.decimal ? separator : null;
  }

  return digitsAfter(token, token.indexOf(separator)) === GROUP_DIGIT_COUNT ? null : separator;
}

function toDecimalString(token: string, decimalSeparator: string | null): string | null {
  const splitAt = decimalSeparator ? token.lastIndexOf(decimalSeparator) : -1;
  const rawInteger = splitAt >= 0 ? token.slice(0, splitAt) : token;
  const rawFraction = splitAt >= 0 ? token.slice(splitAt + 1) : "";

  const negative = rawInteger.trimStart().startsWith("-");
  const integer = rawInteger.replace(NON_DIGITS, "");
  const fraction = rawFraction.replace(NON_DIGITS, "");

  if (integer.length === 0 && fraction.length === 0) {
    return null;
  }

  const whole = integer.replace(LEADING_ZEROS, "") || "0";
  const sign = negative ? "-" : "";
  return fraction.length > 0 ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
}

/**
 * Parses a price out of arbitrary text (or a JSON number) into a decimal string
 * plus, where determinable, an ISO currency code. Returns null when the input
 * contains no number.
 */
export function parsePrice(
  input: string | number,
  options: ParsePriceOptions = {}
): ParsedPrice | null {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) {
      return null;
    }
    const asString = String(input);
    if (PLAIN_DECIMAL.test(asString)) {
      const currency = normalizeCurrency(options.currency);
      return currency ? { amount: asString, currency } : { amount: asString };
    }
    return parsePrice(asString, options);
  }

  const text = normalizeSpaces(input);
  const run = NUMBER_RUN.exec(text);
  if (!run) {
    return null;
  }

  const token = run[0].replace(TRAILING_SEPARATORS, "");
  const amount = toDecimalString(token, resolveDecimalSeparator(token, options.locale));
  if (amount === null) {
    return null;
  }

  const currency = normalizeCurrency(options.currency) ?? detectCurrency(text);
  return currency ? { amount, currency } : { amount };
}
