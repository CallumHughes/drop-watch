import { describe, expect, it } from "vitest";

import { availabilityState, parseAvailability } from "./availability";

describe("parseAvailability", () => {
  it("strips the schema.org URL prefix", () => {
    expect(parseAvailability("https://schema.org/InStock")).toEqual({
      availability: "InStock",
      inStock: true,
    });
    expect(parseAvailability("http://schema.org/OutOfStock")).toEqual({
      availability: "OutOfStock",
      inStock: false,
    });
  });

  it("accepts a bare token", () => {
    expect(parseAvailability("InStock")).toEqual({ availability: "InStock", inStock: true });
  });

  it("is case- and separator-insensitive", () => {
    expect(parseAvailability("in stock")?.inStock).toBe(true);
    expect(parseAvailability("OUT_OF_STOCK")?.inStock).toBe(false);
    expect(parseAvailability("out-of-stock")?.inStock).toBe(false);
  });

  it("treats limited and store-only availability as in stock", () => {
    expect(parseAvailability("LimitedAvailability")?.inStock).toBe(true);
    expect(parseAvailability("InStoreOnly")?.inStock).toBe(true);
    expect(parseAvailability("OnlineOnly")?.inStock).toBe(true);
  });

  it("treats pre-order, back-order and discontinued as not in stock", () => {
    expect(parseAvailability("PreOrder")?.inStock).toBe(false);
    expect(parseAvailability("BackOrder")?.inStock).toBe(false);
    expect(parseAvailability("Discontinued")?.inStock).toBe(false);
    expect(parseAvailability("SoldOut")?.inStock).toBe(false);
  });

  it("keeps an unrecognised token but leaves inStock undefined", () => {
    expect(parseAvailability("https://schema.org/MadeToOrder")).toEqual({
      availability: "MadeToOrder",
    });
  });

  it("returns null for empty input", () => {
    expect(parseAvailability(undefined)).toBeNull();
    expect(parseAvailability(null)).toBeNull();
    expect(parseAvailability("")).toBeNull();
    expect(parseAvailability("   ")).toBeNull();
  });
});

describe("availabilityState", () => {
  it("maps the specific tokens ahead of the boolean", () => {
    expect(availabilityState("BackOrder", false)).toBe("back_order");
    expect(availabilityState("Discontinued", false)).toBe("discontinued");
    expect(availabilityState("LimitedAvailability", true)).toBe("limited");
    expect(availabilityState("PreOrder", false)).toBe("pre_order");
    expect(availabilityState("PreSale", false)).toBe("pre_order");
  });

  it("is case- and separator-insensitive", () => {
    expect(availabilityState("back_order", false)).toBe("back_order");
    expect(availabilityState("pre-order", false)).toBe("pre_order");
  });

  it("falls back to the boolean for a plain in/out-of-stock token", () => {
    expect(availabilityState("InStock", true)).toBe("in_stock");
    expect(availabilityState("OutOfStock", false)).toBe("out_of_stock");
  });

  it("falls back to the boolean when availability is null", () => {
    expect(availabilityState(null, true)).toBe("in_stock");
    expect(availabilityState(null, false)).toBe("out_of_stock");
  });

  it("is unknown when neither says anything", () => {
    expect(availabilityState(null, null)).toBe("unknown");
    expect(availabilityState("MadeToOrder", null)).toBe("unknown");
  });
});
