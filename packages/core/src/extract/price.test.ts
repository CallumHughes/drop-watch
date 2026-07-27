import { describe, expect, it } from "vitest";

import { detectCurrency, normalizeCurrency, parsePrice } from "./price";

describe("parsePrice — the cases named in the plan", () => {
  it("parses £1,234.56 as GBP", () => {
    expect(parsePrice("£1,234.56")).toEqual({ amount: "1234.56", currency: "GBP" });
  });

  it("parses 1.234,56 € as EUR", () => {
    expect(parsePrice("1.234,56 €")).toEqual({ amount: "1234.56", currency: "EUR" });
  });

  it("parses $1234 as USD", () => {
    expect(parsePrice("$1234")).toEqual({ amount: "1234", currency: "USD" });
  });

  it("parses 1 234,56 kr, leaving the ambiguous symbol unresolved", () => {
    expect(parsePrice("1 234,56 kr")).toEqual({ amount: "1234.56" });
  });

  it("parses ¥12,345 as JPY", () => {
    expect(parsePrice("¥12,345")).toEqual({ amount: "12345", currency: "JPY" });
  });
});

describe("parsePrice — separator disambiguation", () => {
  it("treats the rightmost separator as the decimal when both appear", () => {
    expect(parsePrice("1,234.56")?.amount).toBe("1234.56");
    expect(parsePrice("1.234,56")?.amount).toBe("1234.56");
    expect(parsePrice("1,234,567.89")?.amount).toBe("1234567.89");
    expect(parsePrice("1.234.567,89")?.amount).toBe("1234567.89");
  });

  it("treats a lone separator followed by exactly three digits as grouping", () => {
    expect(parsePrice("1,234")?.amount).toBe("1234");
    expect(parsePrice("1.234")?.amount).toBe("1234");
    expect(parsePrice("12,345")?.amount).toBe("12345");
  });

  it("treats a lone separator followed by one or two digits as decimal", () => {
    expect(parsePrice("19.99")?.amount).toBe("19.99");
    expect(parsePrice("19,99")?.amount).toBe("19.99");
    expect(parsePrice("19.9")?.amount).toBe("19.9");
  });

  it("treats a repeated separator as grouping", () => {
    expect(parsePrice("1.234.567")?.amount).toBe("1234567");
    expect(parsePrice("1,234,567")?.amount).toBe("1234567");
  });

  it("treats spaces and apostrophes as grouping", () => {
    expect(parsePrice("1 234 567,89")?.amount).toBe("1234567.89");
    expect(parsePrice("1'234.56")?.amount).toBe("1234.56");
  });

  it("strips non-breaking and narrow no-break spaces", () => {
    expect(parsePrice("1\u00A0234,56")?.amount).toBe("1234.56");
    expect(parsePrice("1\u202F234,56")?.amount).toBe("1234.56");
    expect(parsePrice("1\u2009234,56")?.amount).toBe("1234.56");
  });
});

describe("parsePrice — locale override", () => {
  it("reads a lone dot as decimal under en-GB", () => {
    expect(parsePrice("1.234", { locale: "en-GB" })?.amount).toBe("1.234");
  });

  it("reads a lone dot as grouping under de-DE", () => {
    expect(parsePrice("1.234", { locale: "de-DE" })?.amount).toBe("1234");
  });

  it("reads a lone comma as decimal under de-DE", () => {
    expect(parsePrice("1,234", { locale: "de-DE" })?.amount).toBe("1.234");
  });

  it("reads a lone comma as grouping under en-GB", () => {
    expect(parsePrice("1,234", { locale: "en-GB" })?.amount).toBe("1234");
  });

  it("falls back to the default rule for an unusable locale", () => {
    expect(parsePrice("1,234", { locale: "not-a-locale!!" })?.amount).toBe("1234");
  });

  it("does not let a locale override the both-separators rule", () => {
    expect(parsePrice("1.234,56", { locale: "en-GB" })?.amount).toBe("1234.56");
  });
});

describe("parsePrice — currency resolution", () => {
  it("prefers an explicit currency over symbol detection", () => {
    expect(parsePrice("$1234", { currency: "CAD" })).toEqual({
      amount: "1234",
      currency: "CAD",
    });
  });

  it("normalises a lowercase explicit currency", () => {
    expect(parsePrice("1234", { currency: "gbp" })?.currency).toBe("GBP");
  });

  it("accepts a symbol as the explicit currency hint", () => {
    expect(parsePrice("1234", { currency: "£" })?.currency).toBe("GBP");
  });

  it("reads an ISO code written in the text", () => {
    expect(parsePrice("1234.56 SEK")).toEqual({ amount: "1234.56", currency: "SEK" });
    expect(parsePrice("CHF120.00")).toEqual({ amount: "120.00", currency: "CHF" });
  });

  it("prefers a specific symbol over the bare dollar sign", () => {
    expect(parsePrice("R$ 1.234,56")?.currency).toBe("BRL");
    expect(parsePrice("US$19.99")?.currency).toBe("USD");
  });

  it("omits currency when nothing identifies it", () => {
    expect(parsePrice("1234.56")).toEqual({ amount: "1234.56" });
  });
});

describe("parsePrice — messy real-world input", () => {
  it("pulls a price out of surrounding text", () => {
    expect(parsePrice("Now only £29.99 (was £49.99)")).toEqual({
      amount: "29.99",
      currency: "GBP",
    });
  });

  it("accepts a JSON number", () => {
    expect(parsePrice(1234.56)).toEqual({ amount: "1234.56" });
    expect(parsePrice(29)).toEqual({ amount: "29" });
  });

  it("attaches an explicit currency to a JSON number", () => {
    expect(parsePrice(19.99, { currency: "EUR" })).toEqual({ amount: "19.99", currency: "EUR" });
  });

  it("strips leading zeros", () => {
    expect(parsePrice("0019.99")?.amount).toBe("19.99");
    expect(parsePrice("000")?.amount).toBe("0");
  });

  it("keeps a zero price", () => {
    expect(parsePrice("0.00")).toEqual({ amount: "0.00" });
  });

  it("handles a negative value", () => {
    expect(parsePrice("-15.50")?.amount).toBe("-15.50");
  });

  it("returns null when there is no number", () => {
    expect(parsePrice("Out of stock")).toBeNull();
    expect(parsePrice("")).toBeNull();
    expect(parsePrice("£")).toBeNull();
  });

  it("returns null for a non-finite number", () => {
    expect(parsePrice(Number.NaN)).toBeNull();
    expect(parsePrice(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("detectCurrency", () => {
  it("finds a known ISO code", () => {
    expect(detectCurrency("Price: 12.00 NOK")).toBe("NOK");
  });

  it("ignores three-letter words that are not currencies", () => {
    expect(detectCurrency("ADD TO BAG")).toBeUndefined();
    expect(detectCurrency("ADD TO BAG $19.99")).toBe("USD");
  });

  it("does not guess at ambiguous symbols", () => {
    expect(detectCurrency("1 234,56 kr")).toBeUndefined();
  });
});

describe("normalizeCurrency", () => {
  it("upper-cases a three-letter code", () => {
    expect(normalizeCurrency("eur")).toBe("EUR");
  });

  it("maps a symbol to its code", () => {
    expect(normalizeCurrency("€")).toBe("EUR");
  });

  it("returns undefined for empty or unknown input", () => {
    expect(normalizeCurrency(undefined)).toBeUndefined();
    expect(normalizeCurrency("  ")).toBeUndefined();
    expect(normalizeCurrency("bananas")).toBeUndefined();
  });
});
