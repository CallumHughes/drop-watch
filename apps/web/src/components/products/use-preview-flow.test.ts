import { describe, expect, it } from "vitest";

import {
  isCurrentPreviewRequest,
  normalizePreviewLocale,
  transportReloadControl,
} from "./use-preview-flow";

describe("normalizePreviewLocale", () => {
  it("trims a locale and omits blank drafts", () => {
    expect(normalizePreviewLocale(" de-DE ")).toBe("de-DE");
    expect(normalizePreviewLocale("   ")).toBeUndefined();
    expect(normalizePreviewLocale(undefined)).toBeUndefined();
  });
});

describe("isCurrentPreviewRequest", () => {
  it("ignores a response from a cancelled or superseded generation", () => {
    expect(isCurrentPreviewRequest(2, 3)).toBe(false);
    expect(isCurrentPreviewRequest(2, 2)).toBe(true);
    expect(isCurrentPreviewRequest(undefined, 2)).toBe(false);
  });
});

describe("transportReloadControl", () => {
  it("leaves browser reload enabled while capabilities are unknown or failed", () => {
    expect(
      transportReloadControl({
        browserRender: undefined,
        currentRender: "http",
        preconditionFailed: false,
      })
    ).toEqual({ disabled: false, target: "browser", unavailable: false });
  });

  it("disables browser reload when capabilities explicitly report no renderer", () => {
    expect(
      transportReloadControl({
        browserRender: false,
        currentRender: "http",
        preconditionFailed: false,
      })
    ).toEqual({ disabled: true, target: "browser", unavailable: true });
  });

  it("does not retry after the browser request rejects its configuration", () => {
    expect(
      transportReloadControl({
        browserRender: true,
        currentRender: "http",
        preconditionFailed: true,
      })
    ).toEqual({ disabled: true, target: "browser", unavailable: false });
  });

  it("always allows a browser preview to return to HTTP", () => {
    expect(
      transportReloadControl({
        browserRender: false,
        currentRender: "browser",
        preconditionFailed: true,
      })
    ).toEqual({ disabled: false, target: "http", unavailable: false });
  });
});
