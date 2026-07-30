/**
 * The add-product preview: fetch a URL once, run the identical extraction chain
 * the worker runs, and hold the body in memory so a selector can be picked
 * against it without touching the network again.
 *
 * "Once" is the whole design. `page` is the only procedure here that reaches
 * out to the internet; `testSelector` and `source` are pure reads of the cached
 * body, which is what makes the picker safe to drive from every keystroke
 * The chain itself is `@drop-watch/core/extract` — the same
 * module `apps/worker` calls — so the preview cannot drift from what a
 * scheduled check will later record.
 *
 * Nothing here touches the database. Saving is `products.create`.
 */

import { randomUUID } from "node:crypto";
import { extract, testSelector } from "@drop-watch/core/extract";
import type { FetchPageResult } from "@drop-watch/core/fetch";
import { fetchPage } from "@drop-watch/core/fetch";
import { ORPCError } from "@orpc/server";
import { createLogger } from "evlog";
import { z } from "zod";

import { protectedProcedure } from "../index";
import {
  type PagePreview,
  PreviewCache,
  type PreviewEntry,
  type SelectorPreview,
  toPreviewExtraction,
  toSelectorPreview,
} from "../preview";

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
/** One retry. A page that is down stays down for the seconds a user will wait. */
const PREVIEW_MAX_RETRIES = 1;

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
 * Turns a transport failure into a client-visible error. The distinction the
 * fetch layer draws — timeout vs. bad response vs. unreachable — is exactly
 * what tells a user whether to retry or to fix the URL, so it survives here
 * rather than collapsing into one "could not fetch".
 */
function fetchFailure(
  result: Exclude<FetchPageResult, { status: "ok" }>
): ORPCError<string, unknown> {
  if (result.status === "timeout") {
    return new ORPCError("GATEWAY_TIMEOUT", { message: `The page timed out: ${result.error}` });
  }
  if (result.status === "not_modified") {
    // No validators are sent on a preview, so a 304 means the origin is
    // misbehaving rather than that we already hold the body.
    return new ORPCError("BAD_GATEWAY", { message: "The page answered 304 with no body" });
  }
  return new ORPCError("BAD_GATEWAY", { message: result.error });
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
   * Fetches a URL once and runs the full fallback chain over it.
   *
   * The body is cached under the returned `previewId`; every later step of the
   * add flow reads that copy.
   */
  page: protectedProcedure
    .input(z.object({ url: urlInput }))
    .handler(async ({ input }): Promise<PagePreview> => {
      const log = createLogger({ action: "preview_page", url: input.url });
      const fetched = await fetchPage(input.url, {
        maxRetries: PREVIEW_MAX_RETRIES,
        timeoutMs: PREVIEW_TIMEOUT_MS,
      });
      log.set({ durationMs: fetched.durationMs, fetchStatus: fetched.status });

      if (fetched.status !== "ok") {
        log.warn("preview fetch failed");
        log.emit();
        throw fetchFailure(fetched);
      }

      const result = extract(fetched.body, { url: fetched.url });
      const previewId = randomUUID();
      previewCache().set(previewId, {
        html: fetched.body,
        storedAt: new Date(),
        url: fetched.url,
      });

      log.set({
        htmlBytes: fetched.body.length,
        httpStatus: fetched.httpStatus,
        previewId,
        strategy: result.ok ? result.strategy : null,
      });
      log.info("preview fetched");
      log.emit();

      return {
        extraction: toPreviewExtraction(result),
        extractionError: result.ok ? null : result.error,
        htmlBytes: fetched.body.length,
        httpStatus: fetched.httpStatus,
        previewId,
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
