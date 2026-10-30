import { describe, expect, it } from "vitest";

import { DEFAULT_USER_AGENT, headedBrands, headedUserAgent, timezoneForLocale } from "./identity";

const PLAIN_CHROME_SUFFIX = / Chrome\/\d+\.0\.0\.0 Safari\/537\.36$/;

describe("timezoneForLocale", () => {
  it.each([
    [undefined, "Europe/London"],
    ["en-GB", "Europe/London"],
    ["de-DE", "Europe/Berlin"],
    ["de", "Europe/Berlin"],
    ["fr-FR", "Europe/Paris"],
    ["ja-JP", "Asia/Tokyo"],
    ["en-DE", "Europe/Berlin"],
    ["invalid_locale", "Europe/London"],
    ["zz-ZZ", "Europe/London"],
  ])("chooses a regional timezone for %s", (locale, expected) => {
    expect(timezoneForLocale(locale)).toBe(expected);
  });
});

describe("headedUserAgent", () => {
  // This exact string is what Imperva refuses on the first request, before any
  // page JavaScript runs.
  it("replaces the headless marker, keeping the real version", () => {
    expect(
      headedUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/156.0.8078.4 Safari/537.36"
      )
    ).toBe(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.4 Safari/537.36"
    );
  });

  it("reports null for a UA that was already headed, so callers can keep it", () => {
    expect(headedUserAgent(DEFAULT_USER_AGENT)).toBeNull();
  });

  it("leaves the Linux build's platform token alone", () => {
    expect(
      headedUserAgent(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/156.0.0.0 Safari/537.36"
      )
    ).toContain("(X11; Linux x86_64)");
  });
});

describe("DEFAULT_USER_AGENT", () => {
  it("claims a plain Chrome, never a headless one", () => {
    expect(DEFAULT_USER_AGENT).not.toContain("Headless");
    expect(DEFAULT_USER_AGENT).toMatch(PLAIN_CHROME_SUFFIX);
  });
});

describe("headedBrands", () => {
  /**
   * The point of renaming rather than rebuilding: Chromium's GREASE brand and
   * its real version numbers survive, so the header cannot contradict the
   * browser that sends it.
   */
  it("renames only the headless entry, keeping GREASE and versions", () => {
    expect(
      headedBrands([
        { brand: "Not:A-Brand", version: "8" },
        { brand: "Chromium", version: "156" },
        { brand: "HeadlessChrome", version: "156" },
      ])
    ).toEqual([
      { brand: "Not:A-Brand", version: "8" },
      { brand: "Chromium", version: "156" },
      { brand: "Google Chrome", version: "156" },
    ]);
  });

  it("leaves a list that never mentioned headless untouched", () => {
    const brands = [
      { brand: "Chromium", version: "156" },
      { brand: "Google Chrome", version: "156" },
    ];
    expect(headedBrands(brands)).toEqual(brands);
  });

  it("handles the full version list's four-part versions", () => {
    expect(headedBrands([{ brand: "HeadlessChrome", version: "156.0.8078.4" }])).toEqual([
      { brand: "Google Chrome", version: "156.0.8078.4" },
    ]);
  });

  it("copes with an empty list", () => {
    expect(headedBrands([])).toEqual([]);
  });
});
