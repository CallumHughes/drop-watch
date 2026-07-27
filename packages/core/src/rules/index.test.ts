import { describe, expect, it } from "vitest";

import {
  type AlertConfig,
  type AlertMemory,
  type AlertStateKey,
  conditionsMet,
  cooldownMs,
  countLeadingFailures,
  DEFAULT_COOLDOWN_MINUTES,
  evaluateAlerts,
  type Observation,
  shouldFire,
  shouldReportBroken,
} from "./index";

const NOW = new Date("2026-07-27T12:00:00.000Z");
const COOLDOWN = cooldownMs();

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 3_600_000);
}

function config(overrides: Partial<AlertConfig> = {}): AlertConfig {
  return {
    dropPercent: null,
    rules: ["target", "drop_percent", "restock"],
    targetPrice: null,
    ...overrides,
  };
}

function at(price: string, inStock: boolean | null = true): Observation {
  return { inStock, price };
}

function memory(entries: [AlertStateKey, AlertMemory][] = []): Map<AlertStateKey, AlertMemory> {
  return new Map(entries);
}

describe("conditionsMet — target", () => {
  it("fires when the price is below the target", () => {
    const triggers = conditionsMet(config({ targetPrice: "60.00" }), at("55.44"), null);
    expect(triggers.map((t) => t.rule)).toEqual(["target"]);
  });

  it("fires when the price is exactly the target", () => {
    expect(conditionsMet(config({ targetPrice: "60.00" }), at("60.00"), null)).toHaveLength(1);
  });

  it("does not fire a penny above the target", () => {
    expect(conditionsMet(config({ targetPrice: "60.00" }), at("60.01"), null)).toEqual([]);
  });

  it("does nothing without a target", () => {
    expect(conditionsMet(config(), at("0.01"), null)).toEqual([]);
  });

  it("is silent when the rule is not enabled", () => {
    const disabled = config({ rules: ["restock"], targetPrice: "60.00" });
    expect(conditionsMet(disabled, at("1.00"), null)).toEqual([]);
  });
});

describe("conditionsMet — drop_percent", () => {
  it("fires on exactly the configured drop", () => {
    const triggers = conditionsMet(config({ dropPercent: 10 }), at("90.00"), at("100.00"));
    expect(triggers.map((t) => t.rule)).toEqual(["drop_percent"]);
  });

  it("does not fire a penny short of the threshold", () => {
    expect(conditionsMet(config({ dropPercent: 10 }), at("90.01"), at("100.00"))).toEqual([]);
  });

  it("never fires on a rise", () => {
    expect(conditionsMet(config({ dropPercent: 10 }), at("120.00"), at("100.00"))).toEqual([]);
  });

  it("needs a previous observation", () => {
    expect(conditionsMet(config({ dropPercent: 10 }), at("1.00"), null)).toEqual([]);
  });

  it("ignores a previous price of zero rather than dividing by it", () => {
    expect(conditionsMet(config({ dropPercent: 10 }), at("0.00"), at("0.00"))).toEqual([]);
  });
});

describe("conditionsMet — restock", () => {
  it("fires on out-of-stock becoming in-stock", () => {
    const triggers = conditionsMet(config(), at("10.00", true), at("10.00", false));
    expect(triggers.map((t) => t.rule)).toEqual(["restock"]);
  });

  it("does not fire when the product was already in stock", () => {
    expect(conditionsMet(config(), at("10.00", true), at("10.00", true))).toEqual([]);
  });

  it("treats unknown stock as not a restock", () => {
    expect(conditionsMet(config(), at("10.00", true), at("10.00", null))).toEqual([]);
    expect(conditionsMet(config(), at("10.00", null), at("10.00", false))).toEqual([]);
  });
});

describe("conditionsMet — combinations", () => {
  it("reports every rule that holds, in rule order", () => {
    const both = config({ dropPercent: 10, targetPrice: "95.00" });
    const triggers = conditionsMet(both, at("90.00"), at("100.00"));
    expect(triggers.map((t) => t.rule)).toEqual(["target", "drop_percent"]);
  });
});

describe("shouldFire", () => {
  it("fires the first time, with no memory at all", () => {
    expect(shouldFire("55.00", undefined, NOW, COOLDOWN)).toBe(true);
  });

  it("does not re-fire at the same price inside the cooldown", () => {
    const seen = { lastAlertedAt: hoursAgo(3), lastAlertedPrice: "55.00" };
    expect(shouldFire("55.00", seen, NOW, COOLDOWN)).toBe(false);
  });

  it("does not re-fire at a higher price inside the cooldown", () => {
    const seen = { lastAlertedAt: hoursAgo(3), lastAlertedPrice: "55.00" };
    expect(shouldFire("58.00", seen, NOW, COOLDOWN)).toBe(false);
  });

  it("fires again on a further drop, however recent the last alert", () => {
    const seen = { lastAlertedAt: hoursAgo(0.1), lastAlertedPrice: "55.00" };
    expect(shouldFire("54.99", seen, NOW, COOLDOWN)).toBe(true);
  });

  it("fires again at the same price once the cooldown has elapsed", () => {
    const seen = { lastAlertedAt: hoursAgo(13), lastAlertedPrice: "55.00" };
    expect(shouldFire("55.00", seen, NOW, COOLDOWN)).toBe(true);
  });

  it("holds fire right up to the cooldown boundary", () => {
    const seen = {
      lastAlertedAt: hoursAgo(DEFAULT_COOLDOWN_MINUTES / 60),
      lastAlertedPrice: "55.00",
    };
    expect(shouldFire("55.00", seen, NOW, COOLDOWN)).toBe(false);
  });
});

describe("evaluateAlerts", () => {
  const targeted = config({ rules: ["target"], targetPrice: "60.00" });

  it("fires once on a lowered target", () => {
    const fired = evaluateAlerts({
      config: targeted,
      latest: at("55.44"),
      memory: memory(),
      now: NOW,
      previous: at("55.44"),
    });
    expect(fired.map((t) => t.rule)).toEqual(["target"]);
  });

  it("stays silent on the next check at the same price", () => {
    const fired = evaluateAlerts({
      config: targeted,
      latest: at("55.44"),
      memory: memory([["target", { lastAlertedAt: hoursAgo(1), lastAlertedPrice: "55.44" }]]),
      now: NOW,
      previous: at("55.44"),
    });
    expect(fired).toEqual([]);
  });

  it("speaks up again when the price falls further", () => {
    const fired = evaluateAlerts({
      config: targeted,
      latest: at("49.99"),
      memory: memory([["target", { lastAlertedAt: hoursAgo(1), lastAlertedPrice: "55.44" }]]),
      now: NOW,
      previous: at("55.44"),
    });
    expect(fired.map((t) => t.rule)).toEqual(["target"]);
  });

  it("dedupes per rule, not per product", () => {
    const both = config({ dropPercent: 10, targetPrice: "95.00" });
    const fired = evaluateAlerts({
      config: both,
      latest: at("90.00"),
      memory: memory([["target", { lastAlertedAt: hoursAgo(1), lastAlertedPrice: "90.00" }]]),
      now: NOW,
      previous: at("100.00"),
    });
    expect(fired.map((t) => t.rule)).toEqual(["drop_percent"]);
  });

  it("honours an overridden cooldown", () => {
    const seen = memory([["target", { lastAlertedAt: hoursAgo(2), lastAlertedPrice: "55.44" }]]);
    const args = {
      config: targeted,
      latest: at("55.44"),
      memory: seen,
      now: NOW,
      previous: at("55.44"),
    };
    expect(evaluateAlerts({ ...args, cooldownMs: cooldownMs(60) })).toHaveLength(1);
    expect(evaluateAlerts({ ...args, cooldownMs: cooldownMs(180) })).toEqual([]);
  });
});

describe("countLeadingFailures", () => {
  it("is zero when the most recent check succeeded", () => {
    expect(countLeadingFailures([{ status: "ok" }, { status: "http_error" }])).toBe(0);
  });

  it("counts only the current streak", () => {
    expect(
      countLeadingFailures([
        { status: "timeout" },
        { status: "http_error" },
        { status: "ok" },
        { status: "timeout" },
      ])
    ).toBe(2);
  });

  it("is zero with no history at all", () => {
    expect(countLeadingFailures([])).toBe(0);
  });
});

describe("shouldReportBroken", () => {
  it("stays quiet below the threshold", () => {
    expect(shouldReportBroken(4, false)).toBe(false);
  });

  it("reports on reaching the threshold", () => {
    expect(shouldReportBroken(5, false)).toBe(true);
  });

  it("says nothing twice", () => {
    expect(shouldReportBroken(9, true)).toBe(false);
  });

  it("honours a configured threshold", () => {
    expect(shouldReportBroken(2, false, 2)).toBe(true);
    expect(shouldReportBroken(2, false, 3)).toBe(false);
  });
});
