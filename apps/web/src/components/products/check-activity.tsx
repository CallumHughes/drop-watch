"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

import { CHECK_WAIT_CAP_MS, type PendingCheck } from "@/lib/check-refetch";

interface CheckActivity {
  /** Reported by a check-now button once the server has taken the job. */
  onQueued: (queuedAt: Date) => void;
  /** The outstanding check, or null when nothing is expected. */
  pending: PendingCheck | null;
}

const CheckActivityContext = createContext<CheckActivity | null>(null);

const NO_ACTIVITY: CheckActivity = {
  onQueued: () => {
    // No provider: nothing on this page is waiting on the result.
  },
  pending: null,
};

/**
 * Lets a page know a check has been asked for and not yet come back, so its
 * live queries can poll quickly until it does — see `@/lib/check-refetch`.
 *
 * A context rather than props because the presses come from two places: the
 * product-level "check every store" button in the page header, and one button
 * per row inside the Listings card. Both need to reach the queries at the top
 * of the page, and neither is on a path where threading a callback through
 * would read better than this.
 */
export function CheckActivityProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingCheck | null>(null);

  const onQueued = useCallback((queuedAt: Date) => {
    // Newest wins: two presses in a row mean waiting for the later one.
    setPending((current) =>
      current && current.queuedAt > queuedAt
        ? current
        : { expiresAt: Date.now() + CHECK_WAIT_CAP_MS, queuedAt }
    );
  }, []);

  const value = useMemo(() => ({ onQueued, pending }), [onQueued, pending]);

  return <CheckActivityContext.Provider value={value}>{children}</CheckActivityContext.Provider>;
}

/**
 * The surrounding provider, or a no-op when there is none — a check-now button
 * on a page that tracks no wait still queues its check, it just does not speed
 * anything up.
 */
export function useCheckActivity(): CheckActivity {
  return useContext(CheckActivityContext) ?? NO_ACTIVITY;
}
