// HTTP fetching with per-domain rate limiting lands in Epic 2.

const LEADING_WWW = /^www\./;

/**
 * Key used for per-domain concurrency limiting: lowercase hostname without a
 * leading "www.", so www.example.com and example.com share one queue.
 */
export function hostnameKey(url: string): string {
  return new URL(url).hostname.toLowerCase().replace(LEADING_WWW, "");
}
