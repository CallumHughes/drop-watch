/**
 * The wire contract between the worker and the renderer sidecar.
 *
 * Both sides import this module, so a drift is a `check-types` failure rather
 * than a runtime surprise. Nothing here may import anything but zod: the
 * sidecar depends on it, and so — transitively — does the Next.js bundle.
 *
 * The response union is deliberately `FetchPageResult` minus `not_modified`,
 * with `body` renamed `html`. A browser render sends no cache validators, so a
 * 304 is unreachable; everything else maps onto `checkRuns.status` unchanged.
 */

import { z } from "zod";

export const RENDER_PATH = "/render";
export const HEALTH_PATH = "/healthz";

/** The port the sidecar listens on, and the one compose publishes to the network. */
export const DEFAULT_RENDER_PORT = 3002;

/** Same budget a plain fetch gets. A browser is slower, not entitled to longer. */
export const DEFAULT_RENDER_TIMEOUT_MS = 20_000;
/** Ceiling on any caller-supplied budget, so one request cannot pin a worker slot. */
export const MAX_RENDER_TIMEOUT_MS = 60_000;
/** Mirrors the fetch layer's cap. Unlike that one this is not a streaming bound. */
export const DEFAULT_RENDER_MAX_BYTES = 5_000_000;

export const renderRequestSchema = z.object({
  /** BCP 47, passed to the browser context — same hint the extractor takes. */
  locale: z.string().max(35).optional(),
  maxBytes: z.int().positive().max(DEFAULT_RENDER_MAX_BYTES).optional(),
  timeoutMs: z.int().positive().max(MAX_RENDER_TIMEOUT_MS).optional(),
  /**
   * `z.url()` is purely syntactic — on its own it accepts `file:///etc/passwd`
   * and `javascript:`, which undici rejects for free but Chromium will happily
   * navigate. The API layer already refines user input the same way
   * (`packages/api/src/routers/preview.ts`); this repeats it at the contract
   * because the sidecar, not the caller, is the process holding the browser.
   */
  url: z
    .url()
    .max(2048)
    .refine(
      (value) => value.startsWith("http://") || value.startsWith("https://"),
      "Only http and https URLs can be rendered"
    ),
  userAgent: z.string().max(500).optional(),
  /**
   * The `goto` condition only. Network-idle is applied afterwards on its own
   * small budget — as a `goto` condition it hangs forever on any page that
   * polls.
   */
  waitUntil: z.enum(["load", "domcontentloaded"]).optional(),
});

export type RenderRequest = z.infer<typeof renderRequestSchema>;

/**
 * Answered with HTTP 200 whenever the render *ran*, however it went. Non-200 is
 * reserved for the sidecar's own faults (400 malformed, 429 at capacity, 503
 * shutting down) — "the retailer is broken" and "my renderer is broken" must
 * not collapse into the same `check_runs` row.
 */
export const renderResponseSchema = z.discriminatedUnion("status", [
  z.object({
    durationMs: z.number(),
    html: z.string(),
    httpStatus: z.number(),
    status: z.literal("ok"),
    /** Final URL after redirects — the base for resolving relative image URLs. */
    url: z.string(),
  }),
  z.object({
    durationMs: z.number(),
    error: z.string(),
    httpStatus: z.number(),
    status: z.literal("http_error"),
  }),
  z.object({
    durationMs: z.number(),
    error: z.string(),
    status: z.literal("network_error"),
  }),
  z.object({
    durationMs: z.number(),
    error: z.string(),
    status: z.literal("timeout"),
  }),
]);

export type RenderResponse = z.infer<typeof renderResponseSchema>;

/**
 * `ok` is a liveness claim rather than "a browser process exists": it goes
 * false when a render has been in flight past any budget this contract allows.
 * `stalledMs` is that render's age, present only when one is stuck.
 */
export const healthResponseSchema = z.object({
  browser: z.enum(["connected", "idle"]),
  inFlight: z.int(),
  ok: z.boolean(),
  queued: z.int(),
  stalledMs: z.int().optional(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
