import { describe, expect, it } from "vitest";
import { jitteredIntervalMs, nextCheckAt } from "./schedule";

const MINUTE = 60_000;

describe("jitteredIntervalMs", () => {
  it("returns the plain interval when jitter is zero", () => {
    expect(jitteredIntervalMs(180, 0, () => 0.5)).toBe(180 * MINUTE);
  });

  it("subtracts the full spread at the bottom of the random range", () => {
    // random() === 0 maps to the -1 end of the symmetric offset.
    expect(jitteredIntervalMs(100, 20, () => 0)).toBe(80 * MINUTE);
  });

  it("adds almost the full spread at the top of the random range", () => {
    expect(jitteredIntervalMs(100, 20, () => 1)).toBe(120 * MINUTE);
  });

  it("centres on the configured interval", () => {
    expect(jitteredIntervalMs(100, 20, () => 0.5)).toBe(100 * MINUTE);
  });

  it("never schedules sooner than a minute out", () => {
    // 1 minute interval with 200% jitter would otherwise land in the past.
    expect(jitteredIntervalMs(1, 200, () => 0)).toBe(MINUTE);
  });

  it("treats a negative jitter percent as no jitter", () => {
    expect(jitteredIntervalMs(60, -30, () => 0)).toBe(60 * MINUTE);
  });

  it("stays inside the configured band across the whole random range", () => {
    for (let step = 0; step <= 100; step += 1) {
      const ms = jitteredIntervalMs(180, 20, () => step / 100);
      expect(ms).toBeGreaterThanOrEqual(144 * MINUTE);
      expect(ms).toBeLessThanOrEqual(216 * MINUTE);
    }
  });

  it("spreads real random draws rather than returning one value", () => {
    const draws = new Set(Array.from({ length: 50 }, () => jitteredIntervalMs(180, 20)));
    expect(draws.size).toBeGreaterThan(1);
  });
});

describe("nextCheckAt", () => {
  it("offsets from the supplied instant", () => {
    const from = new Date("2026-07-27T12:00:00.000Z");
    expect(nextCheckAt(from, 180, 0, () => 0.5).toISOString()).toBe("2026-07-27T15:00:00.000Z");
  });

  it("applies the jitter to the offset", () => {
    const from = new Date("2026-07-27T12:00:00.000Z");
    expect(nextCheckAt(from, 100, 20, () => 0).toISOString()).toBe("2026-07-27T13:20:00.000Z");
  });
});
