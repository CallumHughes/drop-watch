/**
 * The pure half of the add-product preview: the short-lived store that holds a
 * fetched page in memory, and the wire shape the picker renders.
 *
 * The selector picker must test against the HTML fetched in step 2 rather
 * than re-fetching per keystroke, which makes this cache the load-bearing part of the flow. Everything here is
 * deliberately free of database and network imports so it can be tested
 * without either — the router does the fetching, this does the remembering.
 */

import type {
  ExtractionResult,
  ExtractorStrategy,
  SelectorMatch,
  SelectorTest,
} from "@drop-watch/core/extract";
import type { UrlVerdict } from "@drop-watch/core/net/guard";
import type { RetrieveResult } from "@drop-watch/core/render";
import type { RenderMode } from "./schemas/products";

/** A one-off preview may choose a transport; saved listings cannot use `auto`. */
export const PREVIEW_REQUEST_MODES = ["auto", "browser", "http"] as const;
export type PreviewRequestMode = (typeof PREVIEW_REQUEST_MODES)[number];

export type PreviewPreflightDecision =
  | { kind: "allowed" | "check_url" }
  | {
      code: "BAD_REQUEST" | "PRECONDITION_FAILED";
      kind: "rejected";
      message: string;
    };

/**
 * Orders preview preconditions without performing DNS or transport work.
 * Explicit browser configuration wins over URL policy so its existing error
 * remains stable; every configured mode then requires one common URL check.
 */
export function decidePreviewPreflight(
  render: PreviewRequestMode,
  renderUrl: string | undefined,
  verdict: UrlVerdict | null
): PreviewPreflightDecision {
  if (render === "browser" && !renderUrl) {
    return {
      code: "PRECONDITION_FAILED",
      kind: "rejected",
      message: "Browser rendering is not configured (RENDER_URL is unset).",
    };
  }
  if (verdict === null) {
    return { kind: "check_url" };
  }
  if (!verdict.ok) {
    return { code: "BAD_REQUEST", kind: "rejected", message: verdict.reason };
  }
  return { kind: "allowed" };
}

/**
 * Lists the transports a preview should try without reaching into runtime
 * configuration. An automatic preview prefers the rendered DOM when a
 * renderer exists, then falls back to the origin response if extraction fails.
 */
export function previewTransports(
  render: PreviewRequestMode,
  renderUrl: string | undefined
): readonly RenderMode[] {
  if (render === "auto") {
    return renderUrl ? ["browser", "http"] : ["http"];
  }
  if (render === "browser") {
    return renderUrl ? ["browser"] : [];
  }
  return ["http"];
}

/** The first transport, retaining an explicit unconfigured-browser signal for the UI. */
export function previewTarget(
  render: PreviewRequestMode,
  renderUrl: string | undefined
): "http" | "browser" | "unconfigured" {
  return previewTransports(render, renderUrl)[0] ?? "unconfigured";
}

export interface PreviewAttempt {
  extraction: ExtractionResult | null;
  result: RetrieveResult;
  transport: RenderMode;
}

type RetrievedPreviewAttempt = PreviewAttempt & {
  extraction: ExtractionResult;
  result: Extract<RetrieveResult, { status: "ok" }>;
};

export type PreviewOrchestration =
  | {
      attempt: RetrievedPreviewAttempt;
      attempts: readonly PreviewAttempt[];
      kind: "extracted" | "no_extraction";
    }
  | { attempts: readonly PreviewAttempt[]; kind: "failed" };

export interface PreviewOrchestrationOptions {
  extractPage: (html: string, url: string) => ExtractionResult;
  render: PreviewRequestMode;
  renderUrl: string | undefined;
  retrieve: (transport: RenderMode) => Promise<RetrieveResult>;
}

/**
 * Retrieves and extracts a page according to the request mode. Only an auto
 * request may use more than one transport. A body is still useful when the
 * extractor misses: selector picking should prefer the browser DOM.
 */
export async function orchestratePreview({
  extractPage,
  render,
  renderUrl,
  retrieve,
}: PreviewOrchestrationOptions): Promise<PreviewOrchestration> {
  const attempts: PreviewAttempt[] = [];

  for (const transport of previewTransports(render, renderUrl)) {
    // biome-ignore lint/performance/noAwaitInLoops: automatic fallback requires the browser result before deciding whether HTTP is needed.
    const result = await retrieve(transport);
    const extraction = result.status === "ok" ? extractPage(result.body, result.url) : null;
    const attempt = { extraction, result, transport };
    attempts.push(attempt);

    if (result.status === "ok" && extraction?.ok) {
      const extractedAttempt: RetrievedPreviewAttempt = { extraction, result, transport };
      return { attempt: extractedAttempt, attempts, kind: "extracted" };
    }
  }

  const browserBody = attempts.find(
    (previewAttempt): previewAttempt is RetrievedPreviewAttempt =>
      previewAttempt.transport === "browser" &&
      previewAttempt.result.status === "ok" &&
      previewAttempt.extraction !== null
  );
  const firstBody = attempts.find(
    (previewAttempt): previewAttempt is RetrievedPreviewAttempt =>
      previewAttempt.result.status === "ok" && previewAttempt.extraction !== null
  );
  const selectedAttempt = browserBody ?? firstBody;

  if (selectedAttempt) {
    return { attempt: selectedAttempt, attempts, kind: "no_extraction" };
  }
  return { attempts, kind: "failed" };
}

export interface PreviewFailure {
  code: "BAD_GATEWAY" | "GATEWAY_TIMEOUT" | "SERVICE_UNAVAILABLE";
  message: string;
}

/** Summarizes every failed transport so an automatic fallback is diagnosable. */
export function previewFailure(attempts: readonly PreviewAttempt[]): PreviewFailure {
  const failures = attempts.filter(
    (attempt): attempt is PreviewAttempt & { result: Exclude<RetrieveResult, { status: "ok" }> } =>
      attempt.result.status !== "ok"
  );
  const allRendererFaults = failures.every((attempt) => attempt.result.status === "renderer_error");
  const allTimeouts = failures.every((attempt) => attempt.result.status === "timeout");
  let code: PreviewFailure["code"] = "BAD_GATEWAY";
  if (allRendererFaults) {
    code = "SERVICE_UNAVAILABLE";
  } else if (allTimeouts) {
    code = "GATEWAY_TIMEOUT";
  }
  const details = failures
    .map((attempt) => `${attempt.transport}: ${failureDescription(attempt.result)}`)
    .join("; ");

  return {
    code,
    message: `Unable to retrieve the page (${details || "no transport was available"}).`,
  };
}

function failureDescription(result: Exclude<RetrieveResult, { status: "ok" }>): string {
  if (result.status === "not_modified") {
    return "the page answered 304 with no body";
  }
  if (result.status === "timeout") {
    return `timed out: ${result.error}`;
  }
  return result.error;
}

/** One fetched page, held only long enough to pick a selector against it. */
export interface PreviewEntry {
  /** Response body, verbatim. What every selector test is run against. */
  html: string;
  storedAt: Date;
  /** Final URL after redirects — the one that gets saved, not the one typed. */
  url: string;
}

export interface PreviewCacheOptions {
  /**
   * Hard ceiling on retained pages. Bodies run to megabytes, so this is a
   * memory bound rather than a hit-rate tuning knob.
   */
  maxEntries: number;
  ttlMs: number;
}

/**
 * A tiny TTL + LRU map of preview id → fetched page.
 *
 * Losing an entry is survivable by design: the UI re-previews, which costs one
 * fetch. That is why nothing here is persisted — a restarted web process
 * simply forgets in-progress previews. Browser-mode entries may contain the
 * post-JavaScript DOM rather than the origin's initial response body.
 */
export class PreviewCache {
  private readonly entries = new Map<string, PreviewEntry>();
  private readonly options: PreviewCacheOptions;

  constructor(options: PreviewCacheOptions) {
    this.options = options;
  }

  get size(): number {
    return this.entries.size;
  }

  /** Drops everything past its TTL. Called on every read and write. */
  prune(now: Date = new Date()): void {
    for (const [id, entry] of this.entries) {
      if (this.isExpired(entry, now)) {
        this.entries.delete(id);
      }
    }
  }

  set(id: string, entry: PreviewEntry, now: Date = new Date()): void {
    this.prune(now);
    this.entries.delete(id);
    this.entries.set(id, entry);
    // Map iterates in insertion order, and a read re-inserts, so the first key
    // is always the least recently used.
    while (this.entries.size > this.options.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) {
        break;
      }
      this.entries.delete(oldest.value);
    }
  }

  /** The cached page, or `undefined` once it has expired or been evicted. */
  get(id: string, now: Date = new Date()): PreviewEntry | undefined {
    const entry = this.entries.get(id);
    if (!entry) {
      return;
    }
    if (this.isExpired(entry, now)) {
      this.entries.delete(id);
      return;
    }
    // Refresh recency so the page being actively worked on is never the one
    // evicted to make room.
    this.entries.delete(id);
    this.entries.set(id, entry);
    return entry;
  }

  private isExpired(entry: PreviewEntry, now: Date): boolean {
    return now.getTime() - entry.storedAt.getTime() > this.options.ttlMs;
  }
}

/**
 * What the chain found, flattened for the wire.
 *
 * `null` rather than absent throughout: the optional fields on
 * {@link ExtractionResult} exist so the extractors can omit what they did not
 * see, but a UI reading `imageUrl` wants one answer, not two ways of saying no.
 */
export interface PreviewExtraction {
  /** Bare schema.org token, e.g. "InStock". */
  availability: string | null;
  currency: string | null;
  imageUrl: string | null;
  inStock: boolean | null;
  /** Decimal string, exactly as it will be stored. */
  price: string;
  /** Which link in the chain won — the thing the preview exists to show. */
  strategy: ExtractorStrategy;
  title: string | null;
}

/** What one previewed page comes back as. */
export interface PagePreview {
  /** What was found, or `null` when the chain came up empty. */
  extraction: PreviewExtraction | null;
  /** Why it came up empty; `null` when it did not. */
  extractionError: string | null;
  /** Size of the cached body, so the UI can say what it is testing against. */
  htmlBytes: number;
  httpStatus: number;
  /** Handle for later selector tests. Meaningless once the entry expires. */
  previewId: string;
  /** Transport that produced this body and extraction. */
  render: RenderMode;
  /** Final URL after redirects. This, not the typed URL, is what gets saved. */
  url: string;
}

export function toPreviewExtraction(result: ExtractionResult): PreviewExtraction | null {
  if (!result.ok) {
    return null;
  }
  return {
    availability: result.availability ?? null,
    currency: result.currency ?? null,
    imageUrl: result.imageUrl ?? null,
    inStock: result.inStock ?? null,
    price: result.price,
    strategy: result.strategy,
    title: result.title ?? null,
  };
}

/**
 * What one candidate selector comes back as.
 *
 * Deliberately the same `extraction` / `extractionError` pair as
 * {@link PagePreview}: whichever way a price was found, the confirm step reads
 * one shape, and the two halves of the flow cannot drift apart.
 */
export interface SelectorPreview {
  extraction: PreviewExtraction | null;
  extractionError: string | null;
  /**
   * The selector is not valid CSS. Worth its own flag because it is what every
   * half-typed selector looks like, and should not read as "wrong selector".
   */
  invalidSelector: boolean;
  matchCount: number;
  /** The first few matched elements, for confirming the right one was hit. */
  samples: SelectorMatch[];
}

export function toSelectorPreview(test: SelectorTest): SelectorPreview {
  return {
    extraction: toPreviewExtraction(test.result),
    extractionError: test.result.ok ? null : test.result.error,
    invalidSelector: test.invalidSelector,
    matchCount: test.matchCount,
    samples: test.samples,
  };
}
