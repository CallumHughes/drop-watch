import { describe, expect, it } from "vitest";

import { checkExpression, checkJsonPathExpression, checkRegexExpression } from "./expression-guard";

describe("checkRegexExpression", () => {
  it.each([
    'data-price="([\\d.]+)"',
    '"price"\\s*:\\s*"?(?<price>[\\d.]+)',
    "[\\s\\S]*?price",
    // Alternation is fine; it is *repeated* alternation that backtracks.
    "(?:£|\\$)([\\d,.]+)",
    "[a|b]+",
    "(a\\|b)+",
  ])("accepts %s", (expression) => {
    expect(checkRegexExpression(expression)).toEqual({ ok: true });
  });

  it("rejects an empty expression", () => {
    expect(checkRegexExpression("   ")).toEqual({ error: "no expression", ok: false });
  });

  it("rejects a pattern that will not compile", () => {
    const check = checkRegexExpression("([0-9]+");
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.error).toContain("not a valid regular expression");
  });

  it("rejects a pattern longer than the column allows", () => {
    const check = checkRegexExpression("a".repeat(501));
    expect(check.ok === false && check.error).toContain("longer than 500 characters");
  });

  it.each(["(a+)+", "(a*)*$", "(a|aa)+", "(\\d+)+x", "([\\s\\S]*)*", "(a+){2,}$", "(a|aa){1,3}$"])(
    "rejects the catastrophic shape %s",
    (expression) => {
      // A user's regex runs in the shared worker process, so one backtracker
      // stalls every listing's checks rather than only its own.
      const check = checkRegexExpression(expression);
      expect(check.ok).toBe(false);
      expect(check.ok === false && check.error).toContain("more than one way");
    }
  );

  it("does not mistake a quantified group with a bounded body for a backtracker", () => {
    expect(checkRegexExpression("(ab)+")).toEqual({ ok: true });
    expect(checkRegexExpression("(a{1,3})+")).toEqual({ ok: true });
    expect(checkRegexExpression("(ab){2,4}")).toEqual({ ok: true });
  });

  it("does not read an escaped paren as a group", () => {
    expect(checkRegexExpression("\\(a+\\)+")).toEqual({ ok: true });
  });

  it("does not read a paren inside a character class as a group", () => {
    expect(checkRegexExpression("[(]a+")).toEqual({ ok: true });
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
    expect(checkExpression("regex", "(a+)+").ok).toBe(false);
    expect(checkExpression("jsonpath", "nope").ok).toBe(false);
  });

  it("passes a CSS selector through, because only cheerio can judge it", () => {
    // This module is loaded by the browser bundle and cannot import cheerio;
    // `testExpression` reports the selector verdict instead.
    expect(checkExpression("selector", "p.price:has(")).toEqual({ ok: true });
  });
});
