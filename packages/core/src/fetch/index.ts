/**
 * HTTP fetching for product pages.
 *
 * Deliberately polite: one request in flight per domain (p-queue keyed by
 * hostname), realistic browser headers, conditional requests via
 * ETag/If-Modified-Since, exponential backoff on 429 and 5xx, and a ~20s cap.
 *
 * At personal-tracking volume this is invisible to target sites. Sites with
 * active bot protection (Amazon in particular) are treated as unsupported —
 * we do not escalate against them.
 */

import PQueue from "p-queue";
import { Agent, fetch as undiciFetch } from "undici";

const LEADING_WWW = /^www\./;

/** Chrome on macOS. Sending a real UA is what keeps most CDNs from 403ing us. */
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const DEFAULT_ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";
const DEFAULT_ACCEPT_LANGUAGE = "en-GB,en;q=0.9";
/**
 * Set explicitly so we never advertise an encoding we cannot decode. undici's
 * own default includes `zstd`, whose decompressor only exists on Node 23+ —
 * left implicit, a zstd-serving origin crashes the process on Node 22.
 */
const DEFAULT_ACCEPT_ENCODING = "gzip, deflate, br";

/** Total budget for one attempt, connect through body. */
const DEFAULT_TIMEOUT_MS = 20_000;
/** Attempts after the first. Three total tries on a flaky origin. */
const DEFAULT_MAX_RETRIES = 2;
/** Refuse absurd bodies rather than buffering them into memory. */
const DEFAULT_MAX_BYTES = 5_000_000;

const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 10_000;
const BACKOFF_JITTER = 0.25;
const MAX_RETRY_AFTER_MS = 30_000;

const HTTP_NOT_MODIFIED = 304;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR = 500;
const MS_PER_SECOND = 1000;

/**
 * Key used for per-domain concurrency limiting: lowercase hostname without a
 * leading "www.", so www.example.com and example.com share one queue.
 */
export function hostnameKey(url: string): string {
  return new URL(url).hostname.toLowerCase().replace(LEADING_WWW, "");
}

const queues = new Map<string, PQueue>();

function queueFor(key: string): PQueue {
  const existing = queues.get(key);
  if (existing) {
    return existing;
  }
  const queue = new PQueue({ concurrency: 1 });
  queues.set(key, queue);
  return queue;
}

export interface FetchPageOptions {
  acceptLanguage?: string;
  /** Previously stored ETag, sent as If-None-Match. */
  etag?: string;
  /** Previously stored Last-Modified, sent as If-Modified-Since. */
  lastModified?: string;
  maxBytes?: number;
  maxRetries?: number;
  /** Caller cancellation, combined with the internal timeout. */
  signal?: AbortSignal;
  timeoutMs?: number;
  userAgent?: string;
}

export interface FetchedPage {
  body: string;
  durationMs: number;
  etag?: string;
  httpStatus: number;
  lastModified?: string;
  status: "ok";
  /** Final URL after redirects — the base for resolving relative image URLs. */
  url: string;
}

/**
 * Failure variants line up with the `checkRuns.status` enum so the worker can
 * record an outcome without re-deriving it.
 */
export type FetchPageResult =
  | FetchedPage
  | {
      durationMs: number;
      etag?: string;
      httpStatus: 304;
      lastModified?: string;
      status: "not_modified";
    }
  | { durationMs: number; error: string; httpStatus: number; status: "http_error" }
  | { durationMs: number; error: string; status: "network_error" }
  | { durationMs: number; error: string; status: "timeout" };

/** 429 and 5xx are worth another go; a 404 never is. */
export function isRetryableStatus(httpStatus: number): boolean {
  return httpStatus === HTTP_TOO_MANY_REQUESTS || httpStatus >= HTTP_SERVER_ERROR;
}

/**
 * Exponential backoff with jitter, honouring a sane `Retry-After` in either of
 * its RFC 9110 forms (delay-seconds or an HTTP-date). Jitter keeps a batch of
 * products on one domain from retrying in lockstep.
 */
export function retryDelayMs(attempt: number, retryAfterHeader?: string | null): number {
  if (retryAfterHeader) {
    const retryAfterSeconds = Number(retryAfterHeader);
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
      return Math.min(retryAfterSeconds * MS_PER_SECOND, MAX_RETRY_AFTER_MS);
    }
    const retryAtMs = Date.parse(retryAfterHeader);
    if (!Number.isNaN(retryAtMs)) {
      return Math.min(Math.max(0, retryAtMs - Date.now()), MAX_RETRY_AFTER_MS);
    }
  }
  const exponential = Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_CAP_MS);
  return Math.round(exponential * (1 + Math.random() * BACKOFF_JITTER));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildHeaders(options: FetchPageOptions): Record<string, string> {
  const headers: Record<string, string> = {
    accept: DEFAULT_ACCEPT,
    "accept-encoding": DEFAULT_ACCEPT_ENCODING,
    "accept-language": options.acceptLanguage ?? DEFAULT_ACCEPT_LANGUAGE,
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "upgrade-insecure-requests": "1",
    "user-agent": options.userAgent ?? DEFAULT_USER_AGENT,
  };
  if (options.etag) {
    headers["if-none-match"] = options.etag;
  }
  if (options.lastModified) {
    headers["if-modified-since"] = options.lastModified;
  }
  return headers;
}

function isTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const causeName = error.cause instanceof Error ? error.cause.name : "";
  const names = new Set(["AbortError", "BodyTimeoutError", "HeadersTimeoutError", "TimeoutError"]);
  return names.has(error.name) || names.has(causeName);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? `: ${error.cause.message}` : "";
    return `${error.message}${cause}`;
  }
  return String(error);
}

/**
 * Structural rather than `Headers`: this module is reachable from `apps/web`,
 * where the global `Headers` is the DOM one and undici's is not assignable to
 * it. Only `get` is ever used, so only `get` is asked for.
 */
interface ReadableHeaders {
  get: (name: string) => string | null;
}

function conditionalHeaders(headers: ReadableHeaders): { etag?: string; lastModified?: string } {
  const result: { etag?: string; lastModified?: string } = {};
  const etag = headers.get("etag");
  if (etag) {
    result.etag = etag;
  }
  const lastModified = headers.get("last-modified");
  if (lastModified) {
    result.lastModified = lastModified;
  }
  return result;
}

interface Attempt {
  result: FetchPageResult;
  retryAfter?: string | null;
}

function tooLarge(byteCount: number, httpStatus: number, durationMs: number): Attempt {
  return {
    result: {
      durationMs,
      error: `response too large (${byteCount} bytes)`,
      httpStatus,
      status: "http_error",
    },
  };
}

type CappedBody = { body: string; ok: true } | { byteCount: number; ok: false };

/**
 * Streams the body, bailing out as soon as the cumulative byte count passes
 * `maxBytes`. A body with no Content-Length never gets fully buffered into
 * memory, and the cap counts bytes rather than UTF-16 code units.
 */
async function readBodyWithCap(
  stream: AsyncIterable<Uint8Array> | null,
  maxBytes: number
): Promise<CappedBody> {
  if (!stream) {
    return { body: "", ok: true };
  }
  const chunks: Uint8Array[] = [];
  let byteCount = 0;
  for await (const chunk of stream) {
    byteCount += chunk.byteLength;
    if (byteCount > maxBytes) {
      // Returning mid-iteration cancels the stream, aborting the download.
      return { byteCount, ok: false };
    }
    chunks.push(chunk);
  }
  const merged = new Uint8Array(byteCount);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { body: new TextDecoder().decode(merged), ok: true };
}

async function attemptFetch(
  url: string,
  options: FetchPageOptions,
  startedAt: number
): Promise<Attempt> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const agent = new Agent({
    bodyTimeout: timeoutMs,
    connect: { timeout: timeoutMs },
    headersTimeout: timeoutMs,
  });
  const elapsed = () => Date.now() - startedAt;

  const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)];
  if (options.signal) {
    signals.push(options.signal);
  }

  try {
    const response = await undiciFetch(url, {
      dispatcher: agent,
      headers: buildHeaders(options),
      redirect: "follow",
      signal: AbortSignal.any(signals),
    });
    const conditional = conditionalHeaders(response.headers);

    if (response.status === HTTP_NOT_MODIFIED) {
      return {
        result: {
          durationMs: elapsed(),
          httpStatus: HTTP_NOT_MODIFIED,
          status: "not_modified",
          ...conditional,
        },
      };
    }

    if (!response.ok) {
      return {
        result: {
          durationMs: elapsed(),
          error: `HTTP ${response.status} ${response.statusText}`.trim(),
          httpStatus: response.status,
          status: "http_error",
        },
        retryAfter: response.headers.get("retry-after"),
      };
    }

    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      return tooLarge(declaredLength, response.status, elapsed());
    }

    const read = await readBodyWithCap(response.body, maxBytes);
    if (!read.ok) {
      return tooLarge(read.byteCount, response.status, elapsed());
    }

    return {
      result: {
        body: read.body,
        durationMs: elapsed(),
        httpStatus: response.status,
        status: "ok",
        url: response.url || url,
        ...conditional,
      },
    };
  } catch (error) {
    if (isTimeout(error)) {
      return {
        result: {
          durationMs: elapsed(),
          error: `timed out after ${timeoutMs}ms`,
          status: "timeout",
        },
      };
    }
    return {
      result: { durationMs: elapsed(), error: errorMessage(error), status: "network_error" },
    };
  } finally {
    await agent.close();
  }
}

function isRetryable(result: FetchPageResult): boolean {
  if (result.status === "network_error") {
    return true;
  }
  return result.status === "http_error" && isRetryableStatus(result.httpStatus);
}

async function fetchWithRetries(url: string, options: FetchPageOptions): Promise<FetchPageResult> {
  const startedAt = Date.now();
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

  for (let attempt = 0; ; attempt += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: retries are sequential by definition — each attempt depends on the previous one failing.
    const { result, retryAfter } = await attemptFetch(url, options, startedAt);
    if (attempt >= maxRetries || !isRetryable(result)) {
      return result;
    }
    await sleep(retryDelayMs(attempt, retryAfter));
  }
}

/**
 * Runs `fn` behind the per-domain queue for `url`.
 *
 * Exported for the browser render path, which reaches the origin through the
 * renderer sidecar rather than through `fetchPage` and would otherwise skip its
 * turn entirely — the request it makes is to `localhost`, not to the store.
 *
 * A URL that will not parse runs unqueued: the queue is politeness, and `fn`
 * reports the bad URL itself.
 */
export async function withDomainQueue<T>(url: string, fn: () => Promise<T>): Promise<T> {
  if (!URL.canParse(url)) {
    return await fn();
  }
  const key = hostnameKey(url);
  const queue = queueFor(key);
  try {
    return await queue.add(fn);
  } finally {
    // Evict the queue once the domain is idle so the map cannot grow without
    // bound. A request queued between completion and this check keeps the
    // queue busy (size/pending non-zero), so it is never dropped mid-use; the
    // identity check guards against deleting a successor queue for the key.
    if (queue.size === 0 && queue.pending === 0 && queues.get(key) === queue) {
      queues.delete(key);
    }
  }
}

/**
 * Fetches a product page, queued behind any other in-flight request to the same
 * domain. Never throws — every failure mode comes back as a result variant.
 */
export async function fetchPage(
  url: string,
  options: FetchPageOptions = {}
): Promise<FetchPageResult> {
  if (!URL.canParse(url)) {
    return {
      durationMs: 0,
      error: `invalid URL: ${url}`,
      status: "network_error",
    };
  }
  return await withDomainQueue(url, () => fetchWithRetries(url, options));
}

/** Number of per-domain queues currently tracked. Exposed for tests. */
export function domainQueueCount(): number {
  return queues.size;
}

/** Requests queued or in flight for a domain. */
export function pendingRequests(url: string): number {
  const queue = queues.get(hostnameKey(url));
  return queue ? queue.size + queue.pending : 0;
}
