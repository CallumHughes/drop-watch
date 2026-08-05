import type { ListingSummary } from "@drop-watch/api/routers/products";
import { describe, expect, it } from "vitest";

import { CHECK_REFETCH_MS, CHECK_WAIT_CAP_MS, checkRefetchInterval } from "./check-refetch";
import { LIVE_REFETCH_MS } from "./format";

const NOW = new Date("2026-07-27T12:00:00.000Z").getTime();
const QUEUED_AT = new Date(NOW);

/** Only the two fields the interval cares about are populated. */
function listing({
  active = true,
  checkedAt,
}: {
  active?: boolean;
  checkedAt: Date | null;
}): ListingSummary {
  return {
    lastCheck: checkedAt ? ({ startedAt: checkedAt } as ListingSummary["lastCheck"]) : null,
    listing: { active } as ListingSummary["listing"],
  } as ListingSummary;
}

const pending = { expiresAt: NOW + CHECK_WAIT_CAP_MS, queuedAt: QUEUED_AT };

describe("checkRefetchInterval", () => {
  it("polls on the normal interval when nothing was asked for", () => {
    expect(checkRefetchInterval([listing({ checkedAt: null })], null, NOW)).toBe(LIVE_REFETCH_MS);
  });

  it("polls quickly while a listing has not reported back", () => {
    const listings = [listing({ checkedAt: new Date(NOW - 60_000) })];
    expect(checkRefetchInterval(listings, pending, NOW + 500)).toBe(CHECK_REFETCH_MS);
  });

  it("polls quickly for a listing that has never been checked", () => {
    expect(checkRefetchInterval([listing({ checkedAt: null })], pending, NOW + 500)).toBe(
      CHECK_REFETCH_MS
    );
  });

  it("returns to the normal interval once the check has landed", () => {
    const listings = [listing({ checkedAt: new Date(NOW + 800) })];
    expect(checkRefetchInterval(listings, pending, NOW + 1000)).toBe(LIVE_REFETCH_MS);
  });

  it("keeps polling until every active listing has reported, not just the first", () => {
    const listings = [
      listing({ checkedAt: new Date(NOW + 800) }),
      listing({ checkedAt: new Date(NOW - 60_000) }),
    ];
    expect(checkRefetchInterval(listings, pending, NOW + 1000)).toBe(CHECK_REFETCH_MS);
  });

  it("ignores inactive listings, which no check was queued for", () => {
    const listings = [
      listing({ checkedAt: new Date(NOW + 800) }),
      listing({ active: false, checkedAt: new Date(NOW - 60_000) }),
    ];
    expect(checkRefetchInterval(listings, pending, NOW + 1000)).toBe(LIVE_REFETCH_MS);
  });

  it("gives up at the cap, so a check that never lands cannot poll forever", () => {
    const listings = [listing({ checkedAt: new Date(NOW - 60_000) })];
    expect(checkRefetchInterval(listings, pending, NOW + CHECK_WAIT_CAP_MS)).toBe(LIVE_REFETCH_MS);
  });

  it("treats a check that started exactly as the job was queued as the answer", () => {
    const listings = [listing({ checkedAt: QUEUED_AT })];
    expect(checkRefetchInterval(listings, pending, NOW + 1000)).toBe(LIVE_REFETCH_MS);
  });
});
