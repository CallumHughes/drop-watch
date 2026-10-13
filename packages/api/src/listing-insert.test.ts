import { describe, expect, it } from "vitest";

import {
  buildListingInsert,
  buildListingPatch,
  buildListingUpdatePatch,
  extractionSettingsChanged,
  type ListingInsertInput,
} from "./listing-insert";
import type { ListingUpdateInput } from "./schemas/listings";

const NOW = new Date("2026-07-27T12:00:00.000Z");
const PULLED_IN = new Date("2026-07-27T12:05:00.000Z");

const listingSettings = {
  etag: '"cached"',
  expression: ".price",
  extractor: "selector" as const,
  lastModified: "Wed, 21 Oct 2026 07:28:00 GMT",
  locale: "en-GB",
  render: "http" as const,
};

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

describe("extractionSettingsChanged", () => {
  it.each([
    ["extractor", { extractor: "jsonpath" as const }],
    ["expression", { expression: ".sale-price" }],
    ["locale", { locale: "de-DE" }],
    ["render", { render: "browser" as const }],
  ])("detects a changed %s", (_setting, input) => {
    expect(extractionSettingsChanged(listingSettings, input)).toBe(true);
  });

  it.each([
    ["extractor", { extractor: listingSettings.extractor }],
    ["expression", { expression: listingSettings.expression }],
    ["locale", { locale: listingSettings.locale }],
    ["render", { render: listingSettings.render }],
  ])("ignores an unchanged %s", (_setting, input) => {
    expect(extractionSettingsChanged(listingSettings, input)).toBe(false);
  });

  it("detects null-to-value and value-to-null transitions", () => {
    expect(
      extractionSettingsChanged({ ...listingSettings, expression: null }, { expression: ".price" })
    ).toBe(true);
    expect(
      extractionSettingsChanged({ ...listingSettings, locale: "en-GB" }, { locale: null })
    ).toBe(true);
    expect(
      extractionSettingsChanged({ ...listingSettings, expression: null }, { expression: null })
    ).toBe(false);
    expect(extractionSettingsChanged({ ...listingSettings, locale: null }, { locale: null })).toBe(
      false
    );
  });
});

describe("buildListingUpdatePatch", () => {
  it.each([
    ["extractor", { extractor: "jsonpath" as const }],
    ["expression", { expression: ".sale-price" }],
    ["locale", { locale: "de-DE" }],
    ["render", { render: "browser" as const }],
  ])("clears cache validators and schedules now for a changed %s", (_setting, input) => {
    expect(
      buildListingUpdatePatch(listingSettings, { id: "listing-1", ...input }, NOW, PULLED_IN)
    ).toEqual({
      ...input,
      etag: null,
      lastModified: null,
      nextCheckAt: NOW,
    });
  });

  it("does not invalidate or reschedule unchanged extraction settings", () => {
    expect(
      buildListingUpdatePatch(
        listingSettings,
        { extractor: listingSettings.extractor, id: "listing-1" },
        NOW,
        undefined
      )
    ).toEqual({ extractor: listingSettings.extractor });
  });

  it("does not invalidate for unrelated settings", () => {
    expect(
      buildListingUpdatePatch(
        listingSettings,
        { active: false, currency: "GBP", id: "listing-1", jitterPercent: 5 },
        NOW,
        undefined
      )
    ).toEqual({ active: false, currency: "GBP", jitterPercent: 5 });
  });

  it("preserves interval pull-in for unrelated changes", () => {
    expect(
      buildListingUpdatePatch(
        listingSettings,
        { id: "listing-1", intervalMinutes: 5 },
        NOW,
        PULLED_IN
      )
    ).toEqual({ intervalMinutes: 5, nextCheckAt: PULLED_IN });
  });

  it("schedules extraction changes now when combined with an interval change", () => {
    expect(
      buildListingUpdatePatch(
        listingSettings,
        { expression: ".sale-price", id: "listing-1", intervalMinutes: 5 },
        NOW,
        PULLED_IN
      )
    ).toEqual({
      etag: null,
      expression: ".sale-price",
      intervalMinutes: 5,
      lastModified: null,
      nextCheckAt: NOW,
    });
  });

  it("invalidates when an extraction setting is cleared", () => {
    expect(
      buildListingUpdatePatch(
        listingSettings,
        { expression: null, id: "listing-1", locale: null },
        NOW,
        undefined
      )
    ).toEqual({ etag: null, expression: null, lastModified: null, locale: null, nextCheckAt: NOW });
  });
});
