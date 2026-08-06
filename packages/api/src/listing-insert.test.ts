import { describe, expect, it } from "vitest";

import { buildListingInsert, buildListingPatch, type ListingInsertInput } from "./listing-insert";
import type { ListingUpdateInput } from "./schemas/listings";

const NOW = new Date("2026-07-27T12:00:00.000Z");

function insertInput(overrides: Partial<ListingInsertInput> = {}): ListingInsertInput {
  return { extractor: "auto", render: "http", url: "https://example.test/p", ...overrides };
}

describe("buildListingInsert", () => {
  it("pins nextCheckAt, productId and userId", () => {
    const result = buildListingInsert(insertInput(), "product-1", "owner-1", NOW);
    expect(result.nextCheckAt).toBe(NOW);
    expect(result.productId).toBe("product-1");
    expect(result.userId).toBe("owner-1");
  });

  it("omits settings that were not supplied, rather than writing them as undefined", () => {
    const result = buildListingInsert(insertInput(), "product-1", "owner-1", NOW);
    expect("currency" in result).toBe(false);
    expect("intervalMinutes" in result).toBe(false);
    expect("jitterPercent" in result).toBe(false);
    expect("locale" in result).toBe(false);
    expect("selector" in result).toBe(false);
  });

  it("carries a supplied setting through, including render", () => {
    const result = buildListingInsert(
      insertInput({ intervalMinutes: 30, render: "browser" }),
      "product-1",
      "owner-1",
      NOW
    );
    expect(result.intervalMinutes).toBe(30);
    expect(result.render).toBe("browser");
  });
});

describe("buildListingPatch", () => {
  const baseUpdate: ListingUpdateInput = { id: "listing-1" };

  it("omits keys that were not supplied", () => {
    const patch = buildListingPatch(baseUpdate);
    expect(patch).toEqual({});
  });

  it("carries a supplied render through", () => {
    const patch = buildListingPatch({ ...baseUpdate, render: "browser" });
    expect(patch).toEqual({ render: "browser" });
  });

  it("carries every other supplied key through and leaves the rest out", () => {
    const patch = buildListingPatch({
      ...baseUpdate,
      active: false,
      intervalMinutes: 45,
    });
    expect(patch).toEqual({ active: false, intervalMinutes: 45 });
  });

  it("carries an explicit null through, distinct from an omitted key", () => {
    const patch = buildListingPatch({ ...baseUpdate, currency: null });
    expect(patch).toEqual({ currency: null });
  });
});
