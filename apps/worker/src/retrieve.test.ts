import { describe, expect, it } from "vitest";
import { RENDER_UNCONFIGURED_ERROR, renderTarget, unconfiguredRenderResult } from "./retrieve";

describe("renderTarget", () => {
  it("goes over http for an http listing with no RENDER_URL", () => {
    expect(renderTarget({ render: "http" }, undefined)).toBe("http");
  });

  it("goes over http for an http listing even when RENDER_URL is set", () => {
    expect(renderTarget({ render: "http" }, "http://renderer:3002")).toBe("http");
  });

  it("goes over browser for a browser listing with RENDER_URL set", () => {
    expect(renderTarget({ render: "browser" }, "http://renderer:3002")).toBe("browser");
  });

  it("is unconfigured for a browser listing with no RENDER_URL", () => {
    expect(renderTarget({ render: "browser" }, undefined)).toBe("unconfigured");
  });
});

describe("unconfiguredRenderResult", () => {
  it("is a network_error carrying the shared constant", () => {
    expect(unconfiguredRenderResult()).toEqual({
      durationMs: 0,
      error: RENDER_UNCONFIGURED_ERROR,
      status: "network_error",
    });
  });

  it("names the unset variable so the failure is self-explanatory", () => {
    expect(RENDER_UNCONFIGURED_ERROR).toContain("RENDER_URL");
  });
});
