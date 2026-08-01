/**
 * The one piece of `alerting.ts` worth unit testing without a Postgres
 * connection — everything else in that module is a query or a `db` write.
 * See `packages/core/src/rules/index.test.ts` for the dedupe and rule
 * semantics this feeds into.
 */

import { describe, expect, it } from "vitest";

import { cheapestByMinorUnits } from "./alerting";

describe("cheapestByMinorUnits", () => {
  it("is null with no rows", () => {
    expect(cheapestByMinorUnits([])).toBeNull();
  });

  it("picks the only row", () => {
    const row = { price: "55.44" };
    expect(cheapestByMinorUnits([row])).toBe(row);
  });

  it("picks the lowest price across rows, regardless of input order", () => {
    const cheapest = { listingId: "b", price: "49.99" };
    const rows = [{ listingId: "a", price: "60.00" }, cheapest, { listingId: "c", price: "50.00" }];
    expect(cheapestByMinorUnits(rows)).toBe(cheapest);
  });

  it("compares in minor units, not lexically", () => {
    // Lexical comparison would put "9.00" below "10.00".
    const cheapest = { price: "9.00" };
    const rows = [{ price: "10.00" }, cheapest];
    expect(cheapestByMinorUnits(rows)).toBe(cheapest);
  });

  it("keeps the first row on a tie", () => {
    const first = { listingId: "a", price: "50.00" };
    const rows = [first, { listingId: "b", price: "50.00" }];
    expect(cheapestByMinorUnits(rows)).toBe(first);
  });
});
