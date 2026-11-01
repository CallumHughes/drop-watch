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
  ExpressionMatch,
  ExpressionMode,
  ExpressionTest,
  ExtractionConfidence,
  ExtractionEvidence,
  ExtractionResult,
  ExtractorStrategy,
} from "@drop-watch/core/extract";
import { extract } from "@drop-watch/core/extract";
import { challengeReason } from "@drop-watch/core/extract/challenge";
import type { Suggestion } from "@drop-watch/core/extract/suggest";
import type { UrlVerdict } from "@drop-watch/core/net/guard";
import type { RetrieveResult } from "@drop-watch/core/render";
import type { RenderMode } from "./schemas/products";

/** A one-off preview may choose a transport; saved listings cannot use `auto`. */
export const PREVIEW_REQUEST_MODES = ["auto", "browser", "http"] as const;
export type PreviewRequestMode = (typeof PREVIEW_REQUEST_MODES)[number];

/** Runs the same extraction chain as a preview page attempt, with its locale hint. */
export function extractPreviewPage(
  html: string,
  url: string,
  locale: string | null | undefined
): ExtractionResult {
  return extract(html, { locale: locale || undefined, url });
}

export interface PreviewRejection {
  code: "BAD_REQUEST" | "PRECONDITION_FAILED";
  message: string;
}

/**
 * Checked first, and before any DNS work, so that asking for a transport the
 * deployment does not have fails the same way whatever the URL is.
 */
export function previewConfigurationRejection(
  render: PreviewRequestMode,
  renderUrl: string | undefined
): PreviewRejection | null {
  if (render === "browser" && !renderUrl) {
    return {
      code: "PRECONDITION_FAILED",
      message: "Browser rendering is not configured (RENDER_URL is unset).",
    };
  }
  return null;
}

/**
 * One common URL check for every mode. Defence in depth and a better immediate
 * message — `fetchPage` and the renderer own the authoritative guards, because
 * each resolves and connects from its own process.
 */
export function previewUrlRejection(verdict: UrlVerdict): PreviewRejection | null {
  return verdict.ok ? null : { code: "BAD_REQUEST", message: verdict.reason };
}

/**
 * Lists the transports a preview should try without reaching into runtime
 * configuration. An automatic preview starts with the cheaper origin response
 * and consults the rendered DOM only when the HTTP evidence is not decisive.
 */
export function previewTransports(
  render: PreviewRequestMode,
  renderUrl: string | undefined
): readonly RenderMode[] {
  if (render === "auto") {
    return renderUrl ? ["http", "browser"] : ["http"];
  }
  if (render === "browser") {
    return renderUrl ? ["browser"] : [];
  }
  return ["http"];
}

export interface PreviewAttempt {
  /**
   * Why this attempt was refused, when it was — a bot-protection interstitial
   * answers 200 with no product on it, so without this the chain reports
   * "no price found" and sends the reader off to write a selector against a
   * page that has none.
   */
  challenge: string | null;
  extraction: ExtractionResult | null;
  result: RetrieveResult;
  transport: RenderMode;
}

type RetrievedPreviewAttempt = Omit<PreviewAttempt, "extraction" | "result"> & {
  extraction: ExtractionResult;
  result: Extract<RetrieveResult, { status: "ok" }>;
};

type ExtractedPreviewAttempt = Omit<RetrievedPreviewAttempt, "extraction"> & {
  extraction: Extract<ExtractionResult, { ok: true }>;
};

export type PreviewFallbackReason = "http_failed" | "http_low_confidence" | "http_no_extraction";

export type PreviewOrchestration =
  | {
      attempt: ExtractedPreviewAttempt;
      attempts: readonly PreviewAttempt[];
      fallbackReason: PreviewFallbackReason | null;
      kind: "extracted";
    }
  | {
      attempt: RetrievedPreviewAttempt;
      attempts: readonly PreviewAttempt[];
      fallbackReason: PreviewFallbackReason | null;
      kind: "no_extraction";
    }
  | {
      attempts: readonly PreviewAttempt[];
      fallbackReason: PreviewFallbackReason | null;
      kind: "failed";
    };

export interface PreviewOrchestrationOptions {
  extractPage: (html: string, url: string) => ExtractionResult;
  render: PreviewRequestMode;
  renderUrl: string | undefined;
  retrieve: (transport: RenderMode) => Promise<RetrieveResult>;
  /** The requested URL, named in a refusal that produced no response to read. */
  url: string;
}

/**
 * Retrieves and extracts a page according to the request mode. Automatic mode
 * only pays for a browser when HTTP is inconclusive, then chooses the stronger
 * observation without discarding a usable HTTP fallback.
 */
export async function orchestratePreview({
  extractPage,
  render,
  renderUrl,
  retrieve,
  url,
}: PreviewOrchestrationOptions): Promise<PreviewOrchestration> {
  const transports = previewTransports(render, renderUrl);
  const [firstTransport, secondTransport] = transports;
  if (!firstTransport) {
    return { attempts: [], fallbackReason: null, kind: "failed" };
  }

  const firstAttempt = await runPreviewAttempt(firstTransport, retrieve, extractPage, url);
  if (!secondTransport) {
    return singleAttemptOutcome(firstAttempt);
  }
  if (isExtractedAttempt(firstAttempt) && firstAttempt.extraction.confidence === "high") {
    return {
      attempt: firstAttempt,
      attempts: [firstAttempt],
      fallbackReason: null,
      kind: "extracted",
    };
  }

  const fallbackReason = httpFallbackReason(firstAttempt);
  const secondAttempt = await runPreviewAttempt(secondTransport, retrieve, extractPage, url);
  const attempts = [firstAttempt, secondAttempt];

  if (isExtractedAttempt(secondAttempt)) {
    if (!isExtractedAttempt(firstAttempt)) {
      return { attempt: secondAttempt, attempts, fallbackReason, kind: "extracted" };
    }
    if (browserShouldWin(firstAttempt, secondAttempt)) {
      const selectedBrowserAttempt = withHttpFallbackCurrency(firstAttempt, secondAttempt);
      return { attempt: selectedBrowserAttempt, attempts, fallbackReason, kind: "extracted" };
    }
    return { attempt: firstAttempt, attempts, fallbackReason, kind: "extracted" };
  }

  if (isExtractedAttempt(firstAttempt)) {
    return { attempt: firstAttempt, attempts, fallbackReason, kind: "extracted" };
  }

  let selectedAttempt: RetrievedPreviewAttempt | null = null;
  if (isRetrievedAttempt(secondAttempt)) {
    selectedAttempt = secondAttempt;
  } else if (isRetrievedAttempt(firstAttempt)) {
    selectedAttempt = firstAttempt;
  }

  if (selectedAttempt) {
    return { attempt: selectedAttempt, attempts, fallbackReason, kind: "no_extraction" };
  }
  return { attempts, fallbackReason, kind: "failed" };
}

async function runPreviewAttempt(
  transport: RenderMode,
  retrieve: PreviewOrchestrationOptions["retrieve"],
  extractPage: PreviewOrchestrationOptions["extractPage"],
  url: string
): Promise<PreviewAttempt> {
  const result = await retrieve(transport);
  const extraction = result.status === "ok" ? extractPage(result.body, result.url) : null;
  // A 403 carries no body to match markers against, which is why the status is
  // a signal in its own right. The post-redirect URL is the better host to
  // name when there was a response at all.
  const challenge = challengeReason(result.status === "ok" ? result.body : "", {
    httpStatus: "httpStatus" in result ? result.httpStatus : undefined,
    transport,
    url: result.status === "ok" ? result.url : url,
  });
  return { challenge, extraction, result, transport };
}

function singleAttemptOutcome(attempt: PreviewAttempt): PreviewOrchestration {
  if (isExtractedAttempt(attempt)) {
    return { attempt, attempts: [attempt], fallbackReason: null, kind: "extracted" };
  }
  if (isRetrievedAttempt(attempt)) {
    return { attempt, attempts: [attempt], fallbackReason: null, kind: "no_extraction" };
  }
  return { attempts: [attempt], fallbackReason: null, kind: "failed" };
}

function isRetrievedAttempt(attempt: PreviewAttempt): attempt is RetrievedPreviewAttempt {
  return attempt.result.status === "ok" && attempt.extraction !== null;
}

function isExtractedAttempt(attempt: PreviewAttempt): attempt is ExtractedPreviewAttempt {
  return isRetrievedAttempt(attempt) && attempt.extraction.ok;
}

function httpFallbackReason(attempt: PreviewAttempt): PreviewFallbackReason {
  if (isExtractedAttempt(attempt)) {
    return "http_low_confidence";
  }
  if (isRetrievedAttempt(attempt)) {
    return "http_no_extraction";
  }
  return "http_failed";
}

function browserShouldWin(
  httpAttempt: ExtractedPreviewAttempt,
  browserAttempt: ExtractedPreviewAttempt
): boolean {
  if (browserAttempt.extraction.confidence !== httpAttempt.extraction.confidence) {
    return browserAttempt.extraction.confidence === "high";
  }
  if (browserAttempt.extraction.confidence === "low") {
    return materiallyChangesTrackedObservation(httpAttempt.extraction, browserAttempt.extraction);
  }
  return false;
}

/**
 * Currency describes the price rather than page state, so an otherwise-winning
 * browser observation may inherit it from HTTP. Availability and stock are not
 * inherited on purpose: the rendered document is the newer observation of page
 * state, and silently carrying "in stock" forward would outlive its evidence.
 * The attempt list keeps the original browser extraction for faithful
 * confidence/evidence logging.
 */
function withHttpFallbackCurrency(
  httpAttempt: ExtractedPreviewAttempt,
  browserAttempt: ExtractedPreviewAttempt
): ExtractedPreviewAttempt {
  if (
    browserAttempt.extraction.currency !== undefined ||
    httpAttempt.extraction.currency === undefined
  ) {
    return browserAttempt;
  }
  return {
    ...browserAttempt,
    extraction: {
      ...browserAttempt.extraction,
      currency: httpAttempt.extraction.currency,
    },
  };
}

function materiallyChangesTrackedObservation(
  httpExtraction: ExtractedPreviewAttempt["extraction"],
  browserExtraction: ExtractedPreviewAttempt["extraction"]
): boolean {
  if (httpExtraction.price !== browserExtraction.price) {
    return true;
  }

  const optionalFields = ["currency", "availability", "inStock"] as const;
  let browserAddsOrChangesValue = false;
  for (const field of optionalFields) {
    const httpValue = httpExtraction[field];
    const browserValue = browserExtraction[field];
    if (httpValue !== undefined && browserValue === undefined) {
      return false;
    }
    if (browserValue !== undefined && browserValue !== httpValue) {
      browserAddsOrChangesValue = true;
    }
  }
  return browserAddsOrChangesValue;
}

/**
 * Always a 4xx, and that is the point.
 *
 * These are verdicts about the *target* page, not about our own health, and
 * oRPC turns the code straight into the HTTP status. The 5xx codes this used to
 * return (`BAD_GATEWAY` → 502, `GATEWAY_TIMEOUT` → 504, `SERVICE_UNAVAILABLE` →
 * 503) are exactly the ones a reverse proxy treats as "my upstream is broken":
 * it replaces the body with its own error page, oRPC's client can no longer
 * parse it, and the real message — the one naming the 403 — is replaced by the
 * generic status text from its own table. Anyone running DropWATCH behind a
 * proxy saw "Bad Gateway" and nothing else. A 422 is passed through untouched.
 */
export interface PreviewFailure {
  code: "UNPROCESSABLE_CONTENT";
  message: string;
}

/** Summarizes every failed transport so an automatic fallback is diagnosable. */
export function previewFailure(attempts: readonly PreviewAttempt[]): PreviewFailure {
  const failures = attempts.filter(
    (attempt): attempt is PreviewAttempt & { result: Exclude<RetrieveResult, { status: "ok" }> } =>
      attempt.result.status !== "ok"
  );
  if (failures.length === 0) {
    // No transport ran at all, so no transport is at fault; `every` over an
    // empty list would otherwise blame the renderer.
    return {
      code: "UNPROCESSABLE_CONTENT",
      message: "Unable to retrieve the page (no transport ran).",
    };
  }
  const details = failures
    .map(
      (attempt) =>
        `${attempt.transport}: ${attempt.challenge ?? failureDescription(attempt.result)}`
    )
    .join("; ");

  return { code: "UNPROCESSABLE_CONTENT", message: `Unable to retrieve the page (${details}).` };
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
  /** Whether the extractor found enough evidence to auto-accept the result. */
  confidence: ExtractionConfidence;
  currency: string | null;
  /** Why the extractor accepted the result, preserved for the safety gate. */
  evidence: ExtractionEvidence;
  imageUrl: string | null;
  inStock: boolean | null;
  /** Decimal string, exactly as it will be stored. */
  price: string;
  /** Which link in the chain won — the thing the preview exists to show. */
  strategy: ExtractorStrategy;
  title: string | null;
}

/**
 * One transport's outcome, as the preview panel needs to read it.
 *
 * Automatic mode may run the browser and have it fail, then still show a usable
 * HTTP body. Without this the UI knows only about the winner, so it offers
 * "Reload in browser" for an attempt that failed seconds earlier in the same
 * request — and the reader pays another render to see the same refusal.
 */
export interface PreviewAttemptSummary {
  /** Already a sentence; `null` when nothing suggested a block. */
  challenge: string | null;
  error: string | null;
  status: RetrieveResult["status"];
  transport: RenderMode;
}

export function toPreviewAttemptSummary(attempt: PreviewAttempt): PreviewAttemptSummary {
  return {
    challenge: attempt.challenge,
    error: "error" in attempt.result ? attempt.result.error : null,
    status: attempt.result.status,
    transport: attempt.transport,
  };
}

/** What one previewed page comes back as. */
export interface PagePreview {
  /** Every transport this preview ran, in the order it ran them. */
  attempts: readonly PreviewAttemptSummary[];
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
    confidence: result.confidence,
    currency: result.currency ?? null,
    evidence: result.evidence,
    imageUrl: result.imageUrl ?? null,
    inStock: result.inStock ?? null,
    price: result.price,
    strategy: result.strategy,
    title: result.title ?? null,
  };
}

export function toPreviewExtractionError(
  result: ExtractionResult,
  challenge: string | null
): string | null {
  if (result.ok) {
    return null;
  }
  return challenge ? `${challenge} ${result.error}` : result.error;
}

/**
 * What one candidate expression comes back as.
 *
 * Deliberately the same `extraction` / `extractionError` pair as
 * {@link PagePreview}: whichever way a price was found, the confirm step reads
 * one shape, and the two halves of the flow cannot drift apart.
 */
export interface ExpressionPreview {
  extraction: PreviewExtraction | null;
  extractionError: string | null;
  /**
   * The expression is not valid in its mode — bad CSS or an unparseable path.
   * Worth its own flag because it is what every
   * half-typed expression looks like, and should not read as "wrong expression".
   */
  invalidExpression: boolean;
  /** Why it is invalid, so the picker can say more than "keep typing". */
  invalidReason: string;
  matchCount: number;
  /** The first few matches, for confirming the right one was hit. */
  samples: ExpressionMatch[];
}

export function toExpressionPreview(test: ExpressionTest): ExpressionPreview {
  return {
    extraction: toPreviewExtraction(test.result),
    extractionError: test.result.ok ? null : test.result.error,
    invalidExpression: test.invalidExpression,
    invalidReason: test.invalidReason,
    matchCount: test.matchCount,
    samples: test.samples,
  };
}

/**
 * One expression the engine worked out from a price the user could already
 * read, as the UI needs it.
 *
 * The expression itself is here because the save path and an agent both need
 * it; the panel shows `sample` and `reason` instead, since choosing between two
 * selectors is the job this flow exists to remove.
 */
export interface SuggestedExpression {
  /** `null` means the listing must supply one — see `toCheckOutcome`. */
  currency: string | null;
  expression: string;
  mode: ExpressionMode;
  /** Why it ranked where it did, already a sentence. */
  reason: string;
  /** The matched value and its surroundings, for confirming the right one. */
  sample: ExpressionMatch;
}

/** A money value the page carries, offered when the typed one is not on it. */
export interface SuggestedPrice {
  amount: string;
  context: string;
  currency: string | null;
}

/** What the automatic chain reads, next to what the user typed. */
export interface AutomaticAgreement {
  agrees: boolean;
  /**
   * The chain's result is one `isAmbiguousExtraction` refuses to record, so
   * agreement alone does not repair the listing.
   */
  ambiguous: boolean;
  currency: string | null;
  price: string;
}

export interface PriceSuggestion {
  automatic: AutomaticAgreement | null;
  /** Ranked most durable first; the panel applies the first. */
  candidates: SuggestedExpression[];
  pricesOnPage: SuggestedPrice[];
}

export function toPriceSuggestion(suggestion: Suggestion): PriceSuggestion {
  return {
    automatic: suggestion.automatic
      ? {
          agrees: suggestion.automatic.agrees,
          ambiguous: suggestion.automatic.ambiguous,
          currency: suggestion.automatic.currency ?? null,
          price: suggestion.automatic.price,
        }
      : null,
    candidates: suggestion.candidates.map((candidate) => ({
      currency: candidate.currency ?? null,
      expression: candidate.expression,
      mode: candidate.mode,
      reason: candidate.reason,
      sample: candidate.sample,
    })),
    pricesOnPage: suggestion.pricesOnPage.map((sighting) => ({
      amount: sighting.amount,
      context: sighting.context,
      currency: sighting.currency ?? null,
    })),
  };
}
