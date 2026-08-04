import { MAX_RENDER_TIMEOUT_MS, renderRequestSchema } from "@drop-watch/core/render/contract";
import { describe, expect, it } from "vitest";
import { classifyError, exceedsByteCap, shouldBlockResource } from "./classify";

describe("classifyError", () => {
  it("classifies a Playwright TimeoutError by name", () => {
    const result = classifyError({ name: "TimeoutError" }, 20_000);
    expect(result.status).toBe("timeout");
  });

  it("classifies an error whose cause is a TimeoutError", () => {
    const cause = new Error("navigation timed out");
    cause.name = "TimeoutError";
    const error = new Error("wrapped", { cause });
    const result = classifyError(error, 20_000);
    expect(result.status).toBe("timeout");
  });

  it("classifies a net::ERR_ message as a network error", () => {
    const result = classifyError(new Error("net::ERR_NAME_NOT_RESOLVED"), 500);
    expect(result).toMatchObject({
      error: "net::ERR_NAME_NOT_RESOLVED",
      status: "network_error",
    });
  });

  it("classifies a plain Error as a network error carrying its message", () => {
    const result = classifyError(new Error("something else went wrong"), 500);
    expect(result).toMatchObject({
      error: "something else went wrong",
      status: "network_error",
    });
  });

  it("classifies a non-Error thrown value as a network error", () => {
    const result = classifyError("just a string", 500);
    expect(result).toMatchObject({ error: "just a string", status: "network_error" });
  });
});

describe("shouldBlockResource", () => {
  it.each(["image", "media", "font", "stylesheet"])("blocks %s", (resourceType) => {
    expect(shouldBlockResource(resourceType)).toBe(true);
  });

  it.each(["document", "script", "xhr", "fetch"])("allows %s", (resourceType) => {
    expect(shouldBlockResource(resourceType)).toBe(false);
  });
});

describe("exceedsByteCap", () => {
  it("returns null when exactly at the boundary", () => {
    expect(exceedsByteCap("abcd", 4)).toBeNull();
  });

  it("returns null when under the boundary", () => {
    expect(exceedsByteCap("abc", 4)).toBeNull();
  });

  it("returns the byte count when over the boundary", () => {
    expect(exceedsByteCap("abcde", 4)).toBe(5);
  });

  it("counts UTF-8 bytes, not UTF-16 code units, for multibyte characters", () => {
    // "🦄" is one UTF-16 "character" as far as .length is concerned in most
    // naive counts, but it is 4 bytes in UTF-8 — a code-unit count would say
    // this fits in 3 bytes and a byte count correctly says it does not.
    const html = "🦄";
    expect(html.length).toBeLessThan(4);
    expect(exceedsByteCap(html, 3)).toBe(4);
  });
});

describe("renderRequestSchema", () => {
  it("rejects a non-URL", () => {
    expect(renderRequestSchema.safeParse({ url: "not-a-url" }).success).toBe(false);
  });

  it("rejects a timeoutMs over MAX_RENDER_TIMEOUT_MS", () => {
    const result = renderRequestSchema.safeParse({
      timeoutMs: MAX_RENDER_TIMEOUT_MS + 1,
      url: "https://example.com",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a plain valid request", () => {
    expect(renderRequestSchema.safeParse({ url: "https://example.com" }).success).toBe(true);
  });

  // Chromium navigates these happily; undici rejects them for free, so the
  // http path never had to care and this one does.
  it.each([
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,<p>x",
    "ftp://example.com",
  ])("rejects the non-http scheme %s", (url) => {
    expect(renderRequestSchema.safeParse({ url }).success).toBe(false);
  });

  it("accepts plain http as well as https", () => {
    expect(renderRequestSchema.safeParse({ url: "http://shop.example.com/x" }).success).toBe(true);
  });
});
