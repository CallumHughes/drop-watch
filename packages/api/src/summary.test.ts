import type { CheckRun, Listing, Product } from "@drop-watch/db/schema/products";
import { describe, expect, it } from "vitest";

import { type PriceSample, pulledInNextCheckAt, summarise } from "./summary";

const NOW = new Date("2026-07-27T12:00:00.000Z");

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60_000);
}

function sample(
  price: string,
  minutes: number,
  inStock: boolean | null = true,
  listingId = "l1"
): PriceSample {
  return {
    availability: null,
    currency: "GBP",
    inStock,
    listingId,
    observedAt: minutesAgo(minutes),
    price,
  };
}

function run(status: CheckRun["status"], minutes: number, listingId = "l1"): CheckRun {
  return {
    durationMs: 120,
    error: status === "ok" ? null : status,
    extractorUsed: status === "ok" ? "jsonld" : null,
    httpStatus: status === "ok" ? 200 : 500,
    id: minutes,
    listingId,
    startedAt: minutesAgo(minutes),
    status,
  };
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    active: true,
    createdAt: minutesAgo(10_000),
    currency: "GBP",
    dropPercent: null,
    id: "p1",
    imageUrl: null,
    rules: [],
    targetPrice: null,
    title: "Bulbasaur",
    updatedAt: minutesAgo(10_000),
    userId: "user-1",
    ...overrides,
  };
}

function listing(overrides: Partial<Listing> = {}): Listing {
  return {
    active: true,
    brokenReportedAt: null,
    createdAt: minutesAgo(10_000),
    currency: "GBP",
    etag: null,
    extractor: "auto",
    id: "l1",
    intervalMinutes: 180,
    jitterPercent: 20,
    lastModified: null,
    locale: null,
    nextCheckAt: new Date("2026-07-27T15:00:00.000Z"),
    productId: "p1",
    render: "http",
    selector: null,
    updatedAt: minutesAgo(10_000),
    url: "https://example.test/p",
    userId: "user-1",
    ...overrides,
  };
}

// The streak count itself is covered in `@drop-watch/core/rules`, where it
// lives; what belongs here is that a summary surfaces it.

describe("summarise", () => {
  it("takes the newest sample as latest, given oldest-first input", () => {
    const result = summarise(product(), [listing()], [sample("63.00", 30), sample("55.44", 5)], []);
    expect(result.latest?.price).toBe("55.44");
    expect(result.previous?.price).toBe("63.00");
    expect(result.changePercent).toBe("-12.0");
  });

  it("reports distance from the target as a decimal string", () => {
    const result = summarise(
      product({ targetPrice: "60.00" }),
      [listing()],
      [sample("63.00", 5)],
      []
    );
    expect(result.targetDelta).toBe("3.00");
  });

  it("reports a met target as a negative distance", () => {
    const result = summarise(
      product({ targetPrice: "60.00" }),
      [listing()],
      [sample("44.50", 5)],
      []
    );
    expect(result.targetDelta).toBe("-15.50");
  });

  it("has no target distance when no target is set", () => {
    expect(summarise(product(), [listing()], [sample("63.00", 5)], []).targetDelta).toBeNull();
  });

  it("has no change percentage from a single observation", () => {
    const result = summarise(product(), [listing()], [sample("63.00", 5)], []);
    expect(result.changePercent).toBeNull();
    expect(result.previous).toBeNull();
  });

  it("copes with a product that has never been checked", () => {
    const result = summarise(product(), [listing()], [], []);
    expect(result.latest).toBeNull();
    expect(result.lastCheck).toBeNull();
    expect(result.consecutiveFailures).toBe(0);
    expect(result.history).toEqual([]);
  });

  it("surfaces the newest check run and the failure streak", () => {
    const result = summarise(
      product(),
      [listing()],
      [],
      [run("timeout", 1), run("timeout", 2), run("ok", 3)]
    );
    expect(result.lastCheck?.status).toBe("timeout");
    expect(result.consecutiveFailures).toBe(2);
  });

  it("builds a per-listing summary alongside the product-level one", () => {
    const result = summarise(
      product(),
      [listing()],
      [sample("63.00", 30), sample("55.44", 5)],
      [run("ok", 5)]
    );
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.listing.id).toBe("l1");
    expect(result.listings[0]?.latest?.price).toBe("55.44");
    expect(result.listings[0]?.lastCheck?.status).toBe("ok");
  });

  it("takes the earliest nextCheckAt across active listings", () => {
    const sooner = listing({ id: "l1", nextCheckAt: new Date("2026-07-27T14:00:00.000Z") });
    const later = listing({ id: "l2", nextCheckAt: new Date("2026-07-27T15:00:00.000Z") });
    const result = summarise(product(), [later, sooner], [], []);
    expect(result.nextCheckAt).toEqual(new Date("2026-07-27T14:00:00.000Z"));
  });

  it("ignores inactive listings when computing nextCheckAt", () => {
    const result = summarise(
      product(),
      [listing({ active: false, nextCheckAt: new Date("2026-07-27T13:00:00.000Z") })],
      [],
      []
    );
    expect(result.nextCheckAt).toBeNull();
  });

  it("has no nextCheckAt when there are no listings", () => {
    expect(summarise(product(), [], [], []).nextCheckAt).toBeNull();
  });
});

describe("summarise with two listings", () => {
  it("takes the cheapest active listing's current sample as latest, in minor units not lexically", () => {
    // Lexical comparison would put "9.99" above "10.00".
    const cheap = listing({ id: "cheap" });
    const dear = listing({ id: "dear" });
    const result = summarise(
      product(),
      [dear, cheap],
      [sample("10.00", 5, true, "dear"), sample("9.99", 5, true, "cheap")],
      []
    );
    expect(result.latest?.price).toBe("9.99");
    expect(result.cheapestListingId).toBe("cheap");
  });

  it("excludes a listing quoted in a different currency than the product", () => {
    const gbp = listing({ id: "gbp" });
    const usd = listing({ id: "usd" });
    const cheaperButWrongCurrency: PriceSample = {
      availability: null,
      currency: "USD",
      inStock: true,
      listingId: "usd",
      observedAt: minutesAgo(5),
      price: "1.00",
    };
    const result = summarise(
      product({ currency: "GBP" }),
      [gbp, usd],
      [sample("50.00", 5, true, "gbp"), cheaperButWrongCurrency],
      []
    );
    expect(result.latest?.price).toBe("50.00");
    expect(result.cheapestListingId).toBe("gbp");
  });

  it("takes changePercent and previous from the cheapest listing's own series, not another store's", () => {
    const cheap = listing({ id: "cheap" });
    const dear = listing({ id: "dear" });
    const result = summarise(
      product(),
      [dear, cheap],
      [
        sample("100.00", 30, true, "dear"),
        sample("90.00", 5, true, "dear"),
        sample("40.00", 30, true, "cheap"),
        sample("30.00", 5, true, "cheap"),
      ],
      []
    );
    expect(result.cheapestListingId).toBe("cheap");
    expect(result.previous?.price).toBe("40.00");
    expect(result.changePercent).toBe("-25.0");
  });

  it("takes the worst failure streak across active listings, ignoring an inactive listing's failures", () => {
    const healthy = listing({ active: true, id: "healthy" });
    const broken = listing({ active: true, id: "broken" });
    const inactiveButWorse = listing({ active: false, id: "paused" });
    const result = summarise(
      product(),
      [healthy, broken, inactiveButWorse],
      [],
      [
        run("ok", 1, "healthy"),
        run("timeout", 1, "broken"),
        run("timeout", 2, "broken"),
        run("timeout", 3, "broken"),
        run("http_error", 1, "paused"),
        run("http_error", 2, "paused"),
        run("http_error", 3, "paused"),
        run("http_error", 4, "paused"),
        run("http_error", 5, "paused"),
      ]
    );
    expect(result.consecutiveFailures).toBe(3);
  });

  it("has no cheapest listing, and zero failures, when no listing is active", () => {
    const result = summarise(
      product(),
      [listing({ active: false })],
      [sample("10.00", 5)],
      [run("timeout", 1)]
    );
    expect(result.latest).toBeNull();
    expect(result.cheapestListingId).toBeNull();
    expect(result.consecutiveFailures).toBe(0);
  });
});

describe("pulledInNextCheckAt", () => {
  it("pulls the next check in when the interval is shortened", () => {
    // Scheduled for 15:00; five minutes from noon is sooner, so it wins.
    expect(pulledInNextCheckAt(listing(), 5, NOW)).toEqual(new Date("2026-07-27T12:05:00.000Z"));
  });

  it("leaves the schedule alone when the new interval lands later", () => {
    expect(pulledInNextCheckAt(listing(), 600, NOW)).toBeUndefined();
  });

  it("never delays a check that is already due", () => {
    const overdue = listing({ nextCheckAt: minutesAgo(60) });
    expect(pulledInNextCheckAt(overdue, 5, NOW)).toBeUndefined();
  });

  it("does nothing when the interval was not part of the edit", () => {
    expect(pulledInNextCheckAt(listing(), undefined, NOW)).toBeUndefined();
  });
});
