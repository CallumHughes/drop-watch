import { describe, expect, it } from "vitest";

import {
  DEFAULT_USER_AGENT,
  headedBrands,
  headedBrandsFromVersion,
  headedUserAgent,
  platformForUserAgent,
  timezoneForLocale,
} from "./identity";

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

  // A region's zone list arrives alphabetically, so reading the first one picks
  // `America/Adak` for the United States and an Antarctic research station for
  // Australia — a browser claiming either is rarer than one claiming nothing.
  it.each([
    ["en-US", "America/New_York"],
    ["es-US", "America/New_York"],
    ["en-CA", "America/Toronto"],
    ["en-AU", "Australia/Sydney"],
    ["pt-BR", "America/Sao_Paulo"],
    ["es-MX", "America/Mexico_City"],
    ["es-ES", "Europe/Madrid"],
    ["pt-PT", "Europe/Lisbon"],
    ["ru-RU", "Europe/Moscow"],
    ["zh-CN", "Asia/Shanghai"],
  ])("picks where the shoppers are, not the alphabet, for %s", (locale, expected) => {
    expect(timezoneForLocale(locale)).toBe(expected);
  });

  // Single-zone regions are unambiguous, so they are deliberately not listed.
  it.each([
    ["it-IT", "Europe/Rome"],
    ["nl-NL", "Europe/Amsterdam"],
    ["sv-SE", "Europe/Stockholm"],
    ["ko-KR", "Asia/Seoul"],
  ])("needs no entry for the single zone of %s", (locale, expected) => {
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

describe("headedBrandsFromVersion", () => {
  // Only reached when the browser could not be asked, and the alternative is
  // sending no brand list at all — which leaves `Sec-CH-UA` announcing
  // `HeadlessChrome` behind a user agent that claims otherwise.
  it("brands a full build string as real Chrome does, by major", () => {
    expect(headedBrandsFromVersion("156.0.8078.4")).toEqual([
      { brand: "Chromium", version: "156" },
      { brand: "Google Chrome", version: "156" },
    ]);
  });

  it("never claims a headless build", () => {
    for (const { brand } of headedBrandsFromVersion("156.0.8078.4")) {
      expect(brand).not.toContain("Headless");
    }
  });

  // No GREASE entry on purpose: Chromium varies it per build, so there is
  // nothing to copy and a guess is a value no real browser repeats.
  it("omits the GREASE brand rather than inventing one", () => {
    expect(headedBrandsFromVersion("156.0.8078.4")).toHaveLength(2);
  });

  it("falls back to the whole string when there is no dot to split on", () => {
    expect(headedBrandsFromVersion("156")).toEqual([
      { brand: "Chromium", version: "156" },
      { brand: "Google Chrome", version: "156" },
    ]);
  });
});

describe("platformForUserAgent", () => {
  // Read from the user agent rather than from the host, so the pair cannot
  // disagree: a macOS UA beside `Sec-CH-UA-Platform: Linux` is its own tell.
  it.each([
    [DEFAULT_USER_AGENT, "macOS"],
    ["Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/156.0.0.0", "Linux"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/156.0.0.0", "Windows"],
    ["Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/156.0.0.0", "Chrome OS"],
    ["Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/156.0.0.0", "Android"],
  ])("reads the platform out of %s", (userAgent, expected) => {
    expect(platformForUserAgent(userAgent)).toBe(expected);
  });

  it("answers Linux for a user agent that names no platform at all", () => {
    expect(platformForUserAgent("DropWatch/1.0 (test)")).toBe("Linux");
  });
});
