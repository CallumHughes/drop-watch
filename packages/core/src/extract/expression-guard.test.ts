import { describe, expect, it } from "vitest";

import {
  checkExpression,
  checkJsonPathExpression,
  checkSelectorExpression,
  parseSelectorExpression,
} from "./expression-guard";

describe("selector attribute expressions", () => {
  it("splits a terminal attribute suffix away from the selector", () => {
    expect(parseSelectorExpression("  [data-price]::attr(data-price)  ")).toEqual({
      attribute: "data-price",
      selector: "[data-price]",
    });
  });

  it("keeps ordinary selectors unchanged", () => {
    expect(parseSelectorExpression("  p.price_color  ")).toEqual({ selector: "p.price_color" });
    expect(parseSelectorExpression('[data-kind="::attr"]')).toEqual({
      selector: '[data-kind="::attr"]',
    });
  });

  it.each([
    "::attr(data-price)",
    "[data-price]::attr()",
    "[data-price]::attr(data price)",
    "[data-price]::attr(data-price) trailing",
    "[data-price]::attr(data-price)::attr(content)",
  ])("rejects malformed suffix %s", (expression) => {
    expect(checkSelectorExpression(expression)).toMatchObject({ ok: false });
  });

  it("accepts surrounding whitespace around a valid attribute expression", () => {
    expect(checkSelectorExpression("  [data-price]::attr(data-price)  ")).toEqual({ ok: true });
  });
});

describe("checkJsonPathExpression", () => {
  it.each(["$..price", "$.props.pageProps.product.price", "$['a'][0]", "$"])(
    "accepts %s",
    (expression) => {
      expect(checkJsonPathExpression(expression)).toEqual({ ok: true });
    }
  );

  it("rejects an empty expression", () => {
    expect(checkJsonPathExpression("  ")).toEqual({ error: "no expression", ok: false });
  });

  it("surfaces the parser's reason so the picker can explain itself", () => {
    const check = checkJsonPathExpression("product.price");
    expect(check.ok === false && check.error).toContain("must start with `$`");
  });
});

describe("checkExpression", () => {
  it("dispatches on the mode", () => {
    expect(checkExpression("jsonpath", "nope").ok).toBe(false);
    expect(checkExpression("selector", "[data-price]::attr()").ok).toBe(false);
  });

  it("passes a CSS selector through, because only cheerio can judge it", () => {
    // This module is loaded by the browser bundle and cannot import cheerio.
    expect(checkExpression("selector", "p.price:has(")).toEqual({ ok: true });
  });
});
