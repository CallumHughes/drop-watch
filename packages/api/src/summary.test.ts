import type { CheckRun, Product } from "@price-tracker/db/schema/products";
import { describe, expect, it } from "vitest";

import { countLeadingFailures, type PriceSample, pulledInNextCheckAt, summarise } from "./summary";

const NOW = new Date("2026-07-27T12:00:00.000Z");

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60_000);
}

function sample(price: string, minutes: number, inStock: boolean | null = true): PriceSample {
  return { currency: "GBP", inStock, observedAt: minutesAgo(minutes), price };
}

function run(status: CheckRun["status"], minutes: number): CheckRun {
  return {
    durationMs: 120,
    error: status === "ok" ? null : status,
    extractorUsed: status === "ok" ? "jsonld" : null,
    httpStatus: status === "ok" ? 200 : 500,
    id: minutes,
    productId: "p1",
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
    etag: null,
    extractor: "auto",
    id: "p1",
    imageUrl: null,
    intervalMinutes: 180,
    jitterPercent: 20,
    lastModified: null,
    locale: null,
    nextCheckAt: new Date("2026-07-27T15:00:00.000Z"),
    render: "http",
    rules: [],
    selector: null,
    targetPrice: null,
    title: "Bulbasaur",
    updatedAt: minutesAgo(10_000),
    url: "https://example.test/p",
    ...overrides,
  };
}

describe("countLeadingFailures", () => {
  it("is zero when the most recent check succeeded", () => {
    expect(countLeadingFailures([run("ok", 1), run("http_error", 2), run("timeout", 3)])).toBe(0);
  });

  it("counts only the current run of failures", () => {
    expect(
      countLeadingFailures([
        run("timeout", 1),
        run("http_error", 2),
        run("ok", 3),
        run("timeout", 4),
      ])
    ).toBe(2);
  });

  it("is zero with no history at all", () => {
    expect(countLeadingFailures([])).toBe(0);
  });
});

describe("summarise", () => {
  it("takes the newest sample as latest, given oldest-first input", () => {
    const result = summarise(product(), [sample("63.00", 30), sample("55.44", 5)], []);
    expect(result.latest?.price).toBe("55.44");
    expect(result.previous?.price).toBe("63.00");
    expect(result.changePercent).toBe("-12.0");
  });

  it("reports distance from the target as a decimal string", () => {
    const result = summarise(product({ targetPrice: "60.00" }), [sample("63.00", 5)], []);
    expect(result.targetDelta).toBe("3.00");
  });

  it("reports a met target as a negative distance", () => {
    const result = summarise(product({ targetPrice: "60.00" }), [sample("44.50", 5)], []);
    expect(result.targetDelta).toBe("-15.50");
  });

  it("has no target distance when no target is set", () => {
    expect(summarise(product(), [sample("63.00", 5)], []).targetDelta).toBeNull();
  });

  it("has no change percentage from a single observation", () => {
    const result = summarise(product(), [sample("63.00", 5)], []);
    expect(result.changePercent).toBeNull();
    expect(result.previous).toBeNull();
  });

  it("copes with a product that has never been checked", () => {
    const result = summarise(product(), [], []);
    expect(result.latest).toBeNull();
    expect(result.lastCheck).toBeNull();
    expect(result.consecutiveFailures).toBe(0);
    expect(result.history).toEqual([]);
  });

  it("surfaces the newest check run and the failure streak", () => {
    const result = summarise(product(), [], [run("timeout", 1), run("timeout", 2), run("ok", 3)]);
    expect(result.lastCheck?.status).toBe("timeout");
    expect(result.consecutiveFailures).toBe(2);
  });
});

describe("pulledInNextCheckAt", () => {
  it("pulls the next check in when the interval is shortened", () => {
    // Scheduled for 15:00; five minutes from noon is sooner, so it wins.
    expect(pulledInNextCheckAt(product(), 5, NOW)).toEqual(new Date("2026-07-27T12:05:00.000Z"));
  });

  it("leaves the schedule alone when the new interval lands later", () => {
    expect(pulledInNextCheckAt(product(), 600, NOW)).toBeUndefined();
  });

  it("never delays a check that is already due", () => {
    const overdue = product({ nextCheckAt: minutesAgo(60) });
    expect(pulledInNextCheckAt(overdue, 5, NOW)).toBeUndefined();
  });

  it("does nothing when the interval was not part of the edit", () => {
    expect(pulledInNextCheckAt(product(), undefined, NOW)).toBeUndefined();
  });
});
