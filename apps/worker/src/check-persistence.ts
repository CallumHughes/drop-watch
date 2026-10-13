import type { FetchPageResult } from "@drop-watch/core/fetch";

export type PersistResult = "persisted" | "stale";

export const STALE_CHECK_DISCARD_MESSAGE =
  "check discarded because the listing changed while it was running; no price, validators, check run, or alert were written — the listing settings will be checked again";

/**
 * A 200 response only earns its cache validators when its price observation is
 * accepted. A rejected body must not make a later 304 look like a healthy
 * observation. A 304 has no new body to accept, but its response headers may
 * legitimately refresh the validators already stored on the listing.
 */
export function validatorUpdate(
  fetched: Extract<FetchPageResult, { status: "ok" | "not_modified" }>,
  acceptedPrice: boolean
): { etag?: string; lastModified?: string } {
  if (fetched.status === "ok" && !acceptedPrice) {
    return {};
  }

  return {
    ...(fetched.etag ? { etag: fetched.etag } : {}),
    ...(fetched.lastModified ? { lastModified: fetched.lastModified } : {}),
  };
}

export interface PersistCallbacks {
  onPersisted: () => Promise<void>;
  onStale: () => void;
}

/**
 * Keeps the stale branch explicit and testable without importing the worker's
 * database module. Stale checks never run alerting because the API may have
 * changed the listing's URL, extractor, schedule or cache state already.
 */
export async function completePersistedCheck(
  result: PersistResult,
  callbacks: PersistCallbacks
): Promise<void> {
  if (result === "stale") {
    callbacks.onStale();
    return;
  }
  await callbacks.onPersisted();
}
