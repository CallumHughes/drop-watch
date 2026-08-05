/**
 * Which URLs may be retrieved, and the DNS lookup that enforces it as a socket
 * is opened.
 *
 * The check belongs in the lookup rather than in a pre-flight validation of the
 * URL: `redirect: "follow"` reaches hosts nobody validated, and a name can
 * resolve publicly once and privately the next time. Resolving and connecting
 * in one step leaves no window to rebind in.
 *
 * `ALLOWED_PRIVATE_HOSTS` exempts named hosts, for a self-hosted instance
 * tracking something on its own network. Unset blocks every non-routable
 * address.
 */

import type { LookupAddress, LookupOneOptions, LookupOptions } from "node:dns";
import dns from "node:dns";
import net from "node:net";
import { isGloballyRoutable } from "./address";

/** Comma-separated hostnames exempted from the private-address block. */
export const ALLOWED_PRIVATE_HOSTS_ENV = "ALLOWED_PRIVATE_HOSTS";

const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

let cachedRaw: string | undefined;
let cachedHosts: ReadonlySet<string> = new Set();

/** Parsed `ALLOWED_PRIVATE_HOSTS`, re-read whenever the raw value changes. */
export function allowedPrivateHosts(): ReadonlySet<string> {
  const raw = process.env[ALLOWED_PRIVATE_HOSTS_ENV] ?? "";
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedHosts = new Set(
      raw
        .split(",")
        .map((host) => host.trim().toLowerCase())
        .filter((host) => host.length > 0)
    );
  }
  return cachedHosts;
}

/** Whether `hostname` is exempt from the address check. */
export function isAllowedPrivateHost(hostname: string): boolean {
  // IPv6 URL hosts arrive bracketed; the allowlist is written without them.
  const bare = hostname.replace(/^\[|]$/g, "").toLowerCase();
  return allowedPrivateHosts().has(bare);
}

export type UrlVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Scheme only. `new URL()` is purely syntactic, so `file:///etc/passwd` and
 * `javascript:` satisfy it — undici refuses those anyway, Chromium does not.
 */
export function checkUrlScheme(url: string): UrlVerdict {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: `invalid URL: ${url}` };
  }
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return { ok: false, reason: `refusing to fetch a ${parsed.protocol} URL` };
  }
  return { ok: true };
}

/** Thrown from the lookup, so the message reaches the caller through undici. */
export class BlockedAddressError extends Error {
  constructor(hostname: string, address: string) {
    super(`refusing to connect to ${hostname}: ${address} is not a public address`);
    this.name = "BlockedAddressError";
  }
}

/**
 * The check {@link guardedLookup} cannot make: `net.connect` skips DNS when the
 * host is already an IP literal. Names return ok here and are judged on resolve.
 */
export function checkLiteralHost(hostname: string): UrlVerdict {
  const bare = hostname.replace(/^\[|]$/g, "");
  if (net.isIP(bare) === 0 || isAllowedPrivateHost(bare)) {
    return { ok: true };
  }
  return isGloballyRoutable(bare)
    ? { ok: true }
    : { ok: false, reason: `${bare} is not a public address` };
}

/**
 * A `net.LookupFunction` that refuses to hand back any address that is not
 * globally routable. Every answer is checked, not just the one that gets used.
 */
export function guardedLookup(
  hostname: string,
  options: LookupOptions | LookupOneOptions,
  callback: (
    error: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number
  ) => void
): void {
  if (isAllowedPrivateHost(hostname)) {
    // `as never` picks one of dns.lookup's overloads; nothing is altered.
    dns.lookup(hostname, options as never, callback as never);
    return;
  }

  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) {
      callback(error, "");
      return;
    }
    const blocked = addresses.find((entry) => !isGloballyRoutable(entry.address));
    if (blocked) {
      callback(new BlockedAddressError(hostname, blocked.address), "");
      return;
    }
    if (options.all) {
      callback(null, addresses);
      return;
    }
    const [first] = addresses;
    if (!first) {
      callback(new BlockedAddressError(hostname, "no addresses"), "");
      return;
    }
    callback(null, first.address, first.family);
  });
}

/**
 * Resolves `hostname` and reports whether every address it answers with is
 * public. Useful for preflight diagnostics; connection-capable callers should
 * prefer {@link guardedLookup} so the checked answer is also the one connected.
 */
export function checkHostAddresses(hostname: string): Promise<UrlVerdict> {
  const bare = hostname.replace(/^\[|]$/g, "");
  if (isAllowedPrivateHost(bare)) {
    return Promise.resolve({ ok: true });
  }
  return new Promise((resolve) => {
    dns.lookup(bare, { all: true }, (error, addresses) => {
      if (error) {
        resolve({ ok: false, reason: `cannot resolve ${bare}: ${error.message}` });
        return;
      }
      const blocked = addresses.find((entry) => !isGloballyRoutable(entry.address));
      resolve(
        blocked
          ? { ok: false, reason: `${bare} resolves to ${blocked.address}, which is not public` }
          : { ok: true }
      );
    });
  });
}

/** Scheme check, then address check. The whole guard, for non-undici callers. */
export async function checkUrl(url: string): Promise<UrlVerdict> {
  const scheme = checkUrlScheme(url);
  if (!scheme.ok) {
    return scheme;
  }
  return await checkHostAddresses(new URL(url).hostname);
}

/**
 * Whether an observed peer address is public. Kept for callers that can inspect
 * a connected socket but cannot inject {@link guardedLookup}.
 */
export function checkPeerAddress(address: string, hostname: string): UrlVerdict {
  if (isAllowedPrivateHost(hostname)) {
    return { ok: true };
  }
  return isGloballyRoutable(address)
    ? { ok: true }
    : { ok: false, reason: `${hostname} was served from ${address}, which is not public` };
}
