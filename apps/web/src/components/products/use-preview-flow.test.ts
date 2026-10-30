import type { PagePreview } from "@drop-watch/api/routers/preview";
import { describe, expect, it } from "vitest";

import {
  failedBrowserAttempt,
  isCurrentPreviewRequest,
  normalizePreviewLocale,
  transportReloadControl,
} from "./use-preview-flow";

function preview(attempts: PagePreview["attempts"]): PagePreview {
  return {
    attempts,
    extraction: null,
    extractionError: "no price found",
    htmlBytes: 6183,
    httpStatus: 200,
    previewId: "11111111-1111-4111-8111-111111111111",
    render: "http",
    url: "https://www.boots.com/p/10332063",
  };
}

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
        alreadyFailed: null,
        browserRender: undefined,
        currentRender: "http",
        preconditionFailed: false,
      })
    ).toEqual({ alreadyFailed: null, disabled: false, target: "browser", unavailable: false });
  });

  it("disables browser reload when capabilities explicitly report no renderer", () => {
    expect(
      transportReloadControl({
        alreadyFailed: null,
        browserRender: false,
        currentRender: "http",
        preconditionFailed: false,
      })
    ).toEqual({ alreadyFailed: null, disabled: true, target: "browser", unavailable: true });
  });

  it("does not retry after the browser request rejects its configuration", () => {
    expect(
      transportReloadControl({
        alreadyFailed: null,
        browserRender: true,
        currentRender: "http",
        preconditionFailed: true,
      })
    ).toEqual({ alreadyFailed: null, disabled: true, target: "browser", unavailable: false });
  });

  it("always allows a browser preview to return to HTTP", () => {
    expect(
      transportReloadControl({
        alreadyFailed: null,
        browserRender: false,
        currentRender: "browser",
        preconditionFailed: true,
      })
    ).toEqual({ alreadyFailed: null, disabled: false, target: "http", unavailable: false });
  });
});

describe("failedBrowserAttempt", () => {
  // Automatic mode escalates to the browser itself. When that fails we still
  // show the HTTP body, so the panel must not charge another render to reach
  // the refusal it already has.
  it("reports the challenge from an escalation that already failed", () => {
    const reason = failedBrowserAttempt(
      preview([
        { challenge: null, error: null, status: "ok", transport: "http" },
        {
          challenge: "boots.com blocked this request (Imperva bot protection).",
          error: "HTTP 403",
          status: "http_error",
          transport: "browser",
        },
      ])
    );
    expect(reason).toBe("boots.com blocked this request (Imperva bot protection).");
  });

  it("falls back to the transport error, then to the status", () => {
    expect(
      failedBrowserAttempt(
        preview([
          {
            challenge: null,
            error: "renderer unreachable",
            status: "renderer_error",
            transport: "browser",
          },
        ])
      )
    ).toBe("renderer unreachable");
    expect(
      failedBrowserAttempt(
        preview([{ challenge: null, error: null, status: "timeout", transport: "browser" }])
      )
    ).toBe("the browser attempt reported timeout");
  });

  it("stays silent when no browser attempt failed", () => {
    expect(failedBrowserAttempt(null)).toBeNull();
    expect(
      failedBrowserAttempt(
        preview([{ challenge: null, error: null, status: "ok", transport: "http" }])
      )
    ).toBeNull();
    expect(
      failedBrowserAttempt(
        preview([{ challenge: null, error: null, status: "ok", transport: "browser" }])
      )
    ).toBeNull();
  });
});

describe("transportReloadControl with a failed escalation", () => {
  it("disables the browser reload and carries the reason", () => {
    expect(
      transportReloadControl({
        alreadyFailed: "boots.com blocked this request.",
        browserRender: true,
        currentRender: "http",
        preconditionFailed: false,
      })
    ).toEqual({
      alreadyFailed: "boots.com blocked this request.",
      disabled: true,
      target: "browser",
      unavailable: false,
    });
  });

  // Going back to HTTP is always allowed, so a browser failure must not leak
  // into the control for the other direction.
  it("ignores it when the target is HTTP", () => {
    expect(
      transportReloadControl({
        alreadyFailed: "boots.com blocked this request.",
        browserRender: true,
        currentRender: "browser",
        preconditionFailed: false,
      })
    ).toEqual({ alreadyFailed: null, disabled: false, target: "http", unavailable: false });
  });
});
