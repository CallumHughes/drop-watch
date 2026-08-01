import { describe, expect, it } from "vitest";
import { retentionCutoff } from "./purge-check-runs";

describe("retentionCutoff", () => {
  it("is 30 days before the supplied instant", () => {
    const now = new Date("2026-08-01T12:00:00.000Z");
    expect(retentionCutoff(now).toISOString()).toBe("2026-07-02T12:00:00.000Z");
  });
});
