import { describe, expect, it } from "vitest";

import {
  cheapestByMinorUnits,
  fromMinorUnits,
  percentChange,
  subtract,
  toMinorUnits,
} from "./decimal";

describe("toMinorUnits", () => {
  it("parses whole and fractional prices", () => {
    expect(toMinorUnits("63.00")).toBe(6300n);
    expect(toMinorUnits("51.77")).toBe(5177n);
    expect(toMinorUnits("1234")).toBe(123_400n);
  });

  it("keeps large values exact where a float would not", () => {
    // 0.1 + 0.2 territory: this is the whole reason prices stay strings.
    expect(toMinorUnits("9999999999.99")).toBe(999_999_999_999n);
  });

  it("handles negative values", () => {
    expect(toMinorUnits("-3.20")).toBe(-320n);
  });

  it("rejects anything that is not a decimal string", () => {
    expect(() => toMinorUnits("£63.00")).toThrow("not a decimal string");
    expect(() => toMinorUnits("")).toThrow("not a decimal string");
  });
});

describe("fromMinorUnits", () => {
  it("always renders two decimal places", () => {
    expect(fromMinorUnits(6300n)).toBe("63.00");
    expect(fromMinorUnits(5n)).toBe("0.05");
    expect(fromMinorUnits(-320n)).toBe("-3.20");
  });
});

describe("subtract", () => {
  it("reports distance from a target price", () => {
    expect(subtract("63.00", "60.00")).toBe("3.00");
    expect(subtract("51.77", "45.00")).toBe("6.77");
  });

  it("goes negative once the price is under target", () => {
    expect(subtract("44.50", "45.00")).toBe("-0.50");
  });
});

describe("percentChange", () => {
  it("reports a drop as a negative percentage", () => {
    expect(percentChange("100.00", "90.00")).toBe("-10.0");
    expect(percentChange("63.00", "55.44")).toBe("-12.0");
  });

  it("reports a rise as a positive percentage", () => {
    expect(percentChange("50.00", "55.00")).toBe("10.0");
  });

  it("is zero for an unchanged price", () => {
    expect(percentChange("63.00", "63.00")).toBe("0.0");
  });

  it("has no answer when the previous price was zero", () => {
    expect(percentChange("0.00", "10.00")).toBeNull();
  });
});

describe("cheapestByMinorUnits", () => {
  it("is null with no rows", () => {
    expect(cheapestByMinorUnits([])).toBeNull();
  });

  it("picks the only row", () => {
    const row = { price: "55.44" };
    expect(cheapestByMinorUnits([row])).toBe(row);
  });

  it("picks the lowest price across rows, regardless of input order", () => {
    const cheapest = { listingId: "b", price: "49.99" };
    const rows = [{ listingId: "a", price: "60.00" }, cheapest, { listingId: "c", price: "50.00" }];
    expect(cheapestByMinorUnits(rows)).toBe(cheapest);
  });

  it("compares in minor units, not lexically", () => {
    // Lexical comparison would put "9.00" below "10.00".
    const cheapest = { price: "9.00" };
    const rows = [{ price: "10.00" }, cheapest];
    expect(cheapestByMinorUnits(rows)).toBe(cheapest);
  });

  it("keeps the first row on a tie", () => {
    const first = { listingId: "a", price: "50.00" };
    const rows = [first, { listingId: "b", price: "50.00" }];
    expect(cheapestByMinorUnits(rows)).toBe(first);
  });
});
