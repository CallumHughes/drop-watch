/**
 * The add-product preview: load a URL through the automatic transport policy,
 * run the identical extraction chain the worker runs, and hold the winning body
 * in memory so a selector can be picked without touching the network again.
 *
 * `page` is the only procedure here that reaches out to the internet;
 * `testSelector` and `source` are pure reads of the cached body, which is what
 * makes the picker safe to drive from every keystroke.
 * The chain itself is `@drop-watch/core/extract` — the same
 * module `apps/worker` calls — so the preview cannot drift from what a
 * scheduled check will later record.
 *
 * Nothing here touches the database. Saving is `products.create`.
 */

import { randomUUID } from "node:crypto";
import { extract, testSelector } from "@drop-watch/core/extract";
import { fetchPage, withDomainQueue } from "@drop-watch/core/fetch";
import { checkUrl } from "@drop-watch/core/net/guard";
import { type RetrieveResult, renderPage } from "@drop-watch/core/render";
import { env } from "@drop-watch/env/server";
import { ORPCError } from "@orpc/server";
import { createLogger } from "evlog";
import { z } from "zod";

import { protectedProcedure } from "../index";
import {
  orchestratePreview,
  type PagePreview,
  PREVIEW_REQUEST_MODES,
  PreviewCache,
  type PreviewEntry,
  previewConfigurationRejection,
  previewFailure,
  previewTransports,
  previewUrlRejection,
  type SelectorPreview,
  toPreviewExtraction,
  toSelectorPreview,
} from "../preview";
import type { RenderMode } from "../schemas/products";

/**
 * Re-exported so `apps/web` can name these shapes without depending on
 * `@drop-watch/core` — the UI reads the API, not the extraction engine.
 */
export type { SelectorMatch } from "@drop-watch/core/extract";
export type { PagePreview, PreviewExtraction, SelectorPreview } from "../preview";

/**
 * Long enough to read a page's markup and work out a selector, short enough
 * that a forgotten tab does not pin a body in memory for the afternoon.
 */
const PREVIEW_TTL_MS = 15 * 60 * 1000;
/** Bodies are megabytes; this is a memory bound, not a hit-rate knob. */
const MAX_PREVIEWS = 10;
/** Previews are interactive — nobody waits 20s at a form. */
const PREVIEW_TIMEOUT_MS = 15_000;
/** Browser startup and network-idle settling need their own interactive budget. */
const PREVIEW_RENDER_TIMEOUT_MS = 20_000;
/** One retry. A page that is down stays down for the seconds a user will wait. */
const PREVIEW_MAX_RETRIES = 1;
/**
 * None when a browser leg follows: that escalation is already the retry, and
 * one "Load preview" click must not stack two HTTP attempts in front of a
 * 20-second render before anything reaches the screen.
 */
const PREVIEW_ESCALATING_RETRIES = 0;

/**
 * Enough markup to find a price by eye without shipping a 5MB body into the
 * browser. The selector still runs against the full document server-side.
 */
const MAX_SOURCE_CHARS = 400_000;

const MAX_SELECTOR_LENGTH = 500;

/**
 * One cache per process, stashed on `globalThis` for the same reason the
 * database pool is: a Next.js hot reload re-evaluates this module, and a fresh
 * cache would silently invalidate every preview the user had open.
 */
const globalForPreviews = globalThis as { __dropWatchPreviews?: PreviewCache };

function previewCache(): PreviewCache {
  const existing = globalForPreviews.__dropWatchPreviews;
  if (existing) {
    return existing;
  }
  const cache = new PreviewCache({ maxEntries: MAX_PREVIEWS, ttlMs: PREVIEW_TTL_MS });
  globalForPreviews.__dropWatchPreviews = cache;
  return cache;
}

/**
 * Retrieves a preview through one requested transport after the handler's
 * common initial-URL preflight. The renderer and `fetchPage` still own the
 * authoritative connection and redirect guards.
 */
async function retrievePreview(
  url: string,
  render: RenderMode,
  renderUrl: string | undefined,
  httpRetries: number
): Promise<RetrieveResult> {
  if (render === "http") {
    return await fetchPage(url, {
      maxRetries: httpRetries,
      timeoutMs: PREVIEW_TIMEOUT_MS,
    });
  }

  if (!renderUrl) {
    return {
      durationMs: 0,
      error: "Browser rendering is not configured (RENDER_URL is unset).",
      status: "renderer_error",
    };
  }

  // `renderPage` calls the sidecar instead of the store, so it needs the same
  // per-domain politeness queue `fetchPage` applies internally.
  return await withDomainQueue(url, () =>
    renderPage(renderUrl, url, { timeoutMs: PREVIEW_RENDER_TIMEOUT_MS })
  );
}

const urlInput = z
  .url()
  .max(2048)
  .refine(
    (value) => value.startsWith("http://") || value.startsWith("https://"),
    "Only http and https URLs can be tracked"
  );

const previewIdInput = z.object({ previewId: z.uuid() });

function requireEntry(previewId: string): PreviewEntry {
  const entry = previewCache().get(previewId);
  if (!entry) {
    throw new ORPCError("NOT_FOUND", {
      message: "This preview has expired. Fetch the page again.",
    });
  }
  return entry;
}

export const previewRouter = {
  /**
   * Loads a URL through the requested transport policy and runs the extraction
   * chain over each retrieved body until one succeeds.
   *
   * The body is cached under the returned `previewId`; every later step of the
   * add flow reads that copy.
   */
  page: protectedProcedure
    .input(z.object({ render: z.enum(PREVIEW_REQUEST_MODES).default("auto"), url: urlInput }))
    .handler(async ({ input }): Promise<PagePreview> => {
      const log = createLogger({ action: "preview_page", url: input.url });
      const configurationRejection = previewConfigurationRejection(input.render, env.RENDER_URL);
      if (configurationRejection) {
        throw new ORPCError(configurationRejection.code, {
          message: configurationRejection.message,
        });
      }

      const urlRejection = previewUrlRejection(await checkUrl(input.url));
      if (urlRejection) {
        throw new ORPCError(urlRejection.code, { message: urlRejection.message });
      }

      const httpRetries =
        previewTransports(input.render, env.RENDER_URL).length > 1
          ? PREVIEW_ESCALATING_RETRIES
          : PREVIEW_MAX_RETRIES;
      const outcome = await orchestratePreview({
        extractPage: (html, url) => extract(html, { url }),
        render: input.render,
        renderUrl: env.RENDER_URL,
        retrieve: async (transport) =>
          await retrievePreview(input.url, transport, env.RENDER_URL, httpRetries),
      });
      const attemptLog = outcome.attempts.map((attempt) => ({
        confidence: attempt.extraction?.ok ? attempt.extraction.confidence : null,
        durationMs: attempt.result.durationMs,
        evidence: attempt.extraction?.ok ? attempt.extraction.evidence : null,
        extraction: attempt.extraction?.ok ?? null,
        status: attempt.result.status,
        transport: attempt.transport,
      }));
      const fallback = outcome.fallbackReason !== null;

      if (outcome.kind === "failed") {
        const failure = previewFailure(outcome.attempts);
        log.set({
          attempts: attemptLog,
          fallback,
          fallbackReason: outcome.fallbackReason,
          winner: null,
        });
        log.warn("preview fetch failed");
        log.emit();
        throw new ORPCError(failure.code, { message: failure.message });
      }

      const fetched = outcome.attempt.result;
      const result = outcome.attempt.extraction;
      const previewId = randomUUID();
      previewCache().set(previewId, {
        html: fetched.body,
        storedAt: new Date(),
        url: fetched.url,
      });

      log.set({
        attempts: attemptLog,
        confidence: result.ok ? result.confidence : null,
        durationMs: fetched.durationMs,
        evidence: result.ok ? result.evidence : null,
        fallback,
        fallbackReason: outcome.fallbackReason,
        fetchStatus: fetched.status,
        htmlBytes: fetched.body.length,
        httpStatus: fetched.httpStatus,
        previewId,
        strategy: result.ok ? result.strategy : null,
        winner: outcome.attempt.transport,
      });
      log.info(
        outcome.kind === "extracted"
          ? "preview extracted"
          : "preview body fetched without extraction"
      );
      log.emit();

      return {
        extraction: toPreviewExtraction(result),
        extractionError: result.ok ? null : result.error,
        htmlBytes: fetched.body.length,
        httpStatus: fetched.httpStatus,
        previewId,
        render: outcome.attempt.transport,
        url: fetched.url,
      };
    }),

  /**
   * The cached markup, truncated, for reading a page that hides its price
   * somewhere unobvious.
   */
  source: protectedProcedure
    .input(previewIdInput)
    .handler(({ input }): { html: string; totalBytes: number; truncated: boolean } => {
      const entry = requireEntry(input.previewId);
      return {
        html: entry.html.slice(0, MAX_SOURCE_CHARS),
        totalBytes: entry.html.length,
        truncated: entry.html.length > MAX_SOURCE_CHARS,
      };
    }),

  /**
   * Runs one candidate selector against the cached body. **No fetch happens
   * here** — that is the point of the cache, and it is what makes calling this
   * on every edit reasonable.
   */
  testSelector: protectedProcedure
    .input(
      previewIdInput.extend({
        locale: z.string().max(35).optional(),
        selector: z.string().max(MAX_SELECTOR_LENGTH),
      })
    )
    .handler(({ input }): SelectorPreview => {
      const entry = requireEntry(input.previewId);
      const test = testSelector(entry.html, {
        selector: input.selector,
        url: entry.url,
        ...(input.locale ? { locale: input.locale } : {}),
      });
      // `fetched: false` is not decoration: it is the line that proves the
      // picker never re-downloads the page.
      const log = createLogger({ action: "preview_test_selector", previewId: input.previewId });
      log.set({
        fetched: false,
        htmlBytes: entry.html.length,
        matchCount: test.matchCount,
        ok: test.result.ok,
        selector: input.selector,
      });
      log.info("selector tested against cached html");
      log.emit();
      return toSelectorPreview(test);
    }),
};
