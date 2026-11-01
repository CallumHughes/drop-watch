import {
  extractPreviewPage,
  orchestratePreview,
  toPreviewAttemptSummary,
  toPreviewExtraction,
} from "@drop-watch/api/preview";
import type {
  ExpressionMatch,
  PagePreview,
  PriceSuggestion,
} from "@drop-watch/api/routers/preview";
import { describe, expect, it } from "vitest";

import {
  failedBrowserAttempt,
  isCurrentPreviewRequest,
  locatorPin,
  normalizePreviewLocale,
  transportReloadControl,
} from "./use-preview-flow";

const SAMPLE: ExpressionMatch = { context: '<span class="price">£24.99</span>', value: "£24.99" };

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
    expect(reason).toMatchObject({
      challenge: "boots.com blocked this request (Imperva bot protection).",
      message: "boots.com blocked this request (Imperva bot protection).",
      status: "http_error",
    });
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
    ).toMatchObject({ challenge: null, message: "renderer unreachable", status: "renderer_error" });
    expect(
      failedBrowserAttempt(
        preview([{ challenge: null, error: null, status: "timeout", transport: "browser" }])
      )
    ).toMatchObject({
      challenge: null,
      message: "the browser attempt reported timeout",
      status: "timeout",
    });
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

  it("reports a 200 browser challenge when the low-confidence HTTP price wins", async () => {
    const outcome = await orchestratePreview({
      extractPage: (html, url) => extractPreviewPage(html, url, undefined),
      render: "auto",
      renderUrl: "http://renderer:3002",
      retrieve: async (transport) => ({
        body:
          transport === "http"
            ? '<meta property="product:price:amount" content="21.50"><meta property="product:price:currency" content="GBP">'
            : '<title>Pardon Our Interruption</title><script src="/_Incapsula_Resource"></script>',
        durationMs: 10,
        httpStatus: 200,
        status: "ok",
        url: "https://www.boots.com/p/10332063",
      }),
      url: "https://www.boots.com/p/10332063",
    });
    expect(outcome.kind).toBe("extracted");
    if (outcome.kind !== "extracted") {
      throw new Error("Expected the HTTP price to win");
    }
    expect(outcome.attempt.transport).toBe("http");
    const result = {
      ...preview(outcome.attempts.map(toPreviewAttemptSummary)),
      extraction: toPreviewExtraction(outcome.attempt.extraction),
      extractionError: null,
    };
    const failure = failedBrowserAttempt(result);
    expect(failure?.status).toBe("ok");
    expect(failure?.message).toContain("Imperva bot protection");
    expect(
      transportReloadControl({
        alreadyFailed: failure,
        browserRender: true,
        currentRender: result.render,
        preconditionFailed: false,
      })
    ).toMatchObject({ alreadyFailed: failure?.message, disabled: true });
  });
});

describe("transportReloadControl with a failed escalation", () => {
  it("disables the browser reload and carries the reason", () => {
    expect(
      transportReloadControl({
        alreadyFailed: failedBrowserAttempt(
          preview([
            {
              challenge: "boots.com blocked this request.",
              error: "HTTP 403",
              status: "http_error",
              transport: "browser",
            },
          ])
        ),
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
        alreadyFailed: failedBrowserAttempt(
          preview([
            {
              challenge: "boots.com blocked this request.",
              error: "HTTP 403",
              status: "http_error",
              transport: "browser",
            },
          ])
        ),
        browserRender: true,
        currentRender: "browser",
        preconditionFailed: false,
      })
    ).toEqual({ alreadyFailed: null, disabled: false, target: "http", unavailable: false });
  });

  it.each(["timeout", "renderer_error", "network_error", "http_error"] as const)(
    "keeps the %s failure visible while allowing a deliberate retry",
    (status) => {
      const failure = failedBrowserAttempt(
        preview([
          {
            challenge: null,
            error: "temporary failure",
            status,
            transport: "browser",
          },
        ])
      );
      expect(
        transportReloadControl({
          alreadyFailed: failure,
          browserRender: true,
          currentRender: "http",
          preconditionFailed: false,
        })
      ).toEqual({
        alreadyFailed: "temporary failure",
        disabled: false,
        target: "browser",
        unavailable: false,
      });
    }
  );
});

describe("locatorPin", () => {
  const candidate = { currency: "GBP", expression: ".price", mode: "selector" as const };
  const suggestion = (overrides: Partial<PriceSuggestion> = {}): PriceSuggestion => ({
    automatic: null,
    candidates: [],
    pricesOnPage: [],
    ...overrides,
  });

  it("pins the top candidate", () => {
    expect(
      locatorPin(suggestion({ candidates: [{ ...candidate, reason: "", sample: SAMPLE }] }))
    ).toEqual({ expression: ".price", mode: "selector" });
  });

  it("pins nothing when the price matched nothing on the page", () => {
    expect(locatorPin(suggestion())).toBeNull();
  });

  it("pins nothing while no answer has arrived", () => {
    // The same answer as "found nothing", on purpose: a stale pin from the
    // previous price must not survive into this one.
    expect(locatorPin(undefined)).toBeNull();
  });

  it("pins nothing when the automatic chain already reads the price", () => {
    expect(
      locatorPin(
        suggestion({
          automatic: { agrees: true, ambiguous: false, currency: "GBP", price: "24.99" },
          candidates: [{ ...candidate, reason: "", sample: SAMPLE }],
        })
      )
    ).toBeNull();
  });

  it("still pins when the chain agrees but its gate would refuse the result", () => {
    expect(
      locatorPin(
        suggestion({
          automatic: { agrees: true, ambiguous: true, currency: "GBP", price: "24.99" },
          candidates: [{ ...candidate, reason: "", sample: SAMPLE }],
        })
      )
    ).toEqual({ expression: ".price", mode: "selector" });
  });
});
