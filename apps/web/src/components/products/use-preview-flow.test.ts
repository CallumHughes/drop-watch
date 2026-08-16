import { describe, expect, it } from "vitest";

import { browserReloadControl } from "./use-preview-flow";

describe("browserReloadControl", () => {
  it("leaves browser reload enabled while capabilities are unknown or failed", () => {
    expect(browserReloadControl({ browserRender: undefined, preconditionFailed: false })).toEqual({
      disabled: false,
      unavailable: false,
    });
  });

  it("disables browser reload when capabilities explicitly report no renderer", () => {
    expect(browserReloadControl({ browserRender: false, preconditionFailed: false })).toEqual({
      disabled: true,
      unavailable: true,
    });
  });

  it("does not retry after the browser request rejects its configuration", () => {
    expect(browserReloadControl({ browserRender: true, preconditionFailed: true })).toEqual({
      disabled: true,
      unavailable: false,
    });
  });
});
