import type { ProductSummary } from "@drop-watch/api/routers/products";
import { describe, expect, it } from "vitest";

import { groupIntoSections } from "./dashboard-sections";

function summary(id: string, overrides: Partial<ProductSummary> = {}): ProductSummary {
  return {
    changePercent: null,
    consecutiveFailures: 0,
    history: [],
    lastCheck: null,
    latest: null,
    listings: [],
    nextCheckAt: null,
    previous: null,
    product: { id } as ProductSummary["product"],
    targetDelta: null,
    ...overrides,
  };
}

describe("groupIntoSections", () => {
  it("puts everything in one untitled section when nothing qualifies", () => {
    const summaries = [summary("a"), summary("b")];
    expect(groupIntoSections(summaries)).toEqual([{ products: summaries, title: null }]);
  });

  it("buckets by failure, target, and drop, leaving the rest as Everything else", () => {
    const failing = summary("failing", { consecutiveFailures: 2 });
    const atTarget = summary("at-target", { targetDelta: "-3.50" });
    const dropped = summary("dropped", { changePercent: "-5.0" });
    const ok = summary("ok");

    const sections = groupIntoSections([failing, atTarget, dropped, ok]);

    expect(sections).toEqual([
      { products: [failing], title: "Needs attention" },
      { products: [atTarget], title: "At or below target" },
      { products: [dropped], title: "Recently dropped" },
      { products: [ok], title: "Everything else" },
    ]);
  });

  it("places a product in the first matching section only", () => {
    const overlapping = summary("overlapping", {
      changePercent: "-1.0",
      consecutiveFailures: 1,
      targetDelta: "0.00",
    });

    const sections = groupIntoSections([overlapping]);

    expect(sections).toEqual([{ products: [overlapping], title: "Needs attention" }]);
  });

  it("treats a zero target delta as at or below target", () => {
    const atZero = summary("zero", { targetDelta: "0.00" });
    expect(groupIntoSections([atZero])).toEqual([
      { products: [atZero], title: "At or below target" },
    ]);
  });

  it("omits empty sections", () => {
    const ok = summary("ok");
    expect(groupIntoSections([ok])).toEqual([{ products: [ok], title: null }]);
  });
});
