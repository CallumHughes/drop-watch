/**
 * The env-seeding path of `loadSettings`: on first boot the row is created
 * from `HA_URL` / `HA_WEBHOOK_ID`.
 *
 * This lives in its own file — and so its own forked process — because the env
 * schema reads `process.env` once at module load. The assignments below must
 * run before that, which is why every `src` import in this file is dynamic:
 * a static import would be hoisted above them.
 */

import { afterAll, describe, expect, it } from "vitest";

process.env.HA_URL = "http://ha.seed.test:8123";
process.env.HA_WEBHOOK_ID = "seed-hook";

describe("loadSettings env seeding", () => {
  afterAll(async () => {
    const { db } = await import("./index");
    await db.$client.end();
  });

  it("seeds the first row from HA_URL and HA_WEBHOOK_ID", async () => {
    const { db } = await import("./index");
    const { settings } = await import("./schema/settings");
    const { loadSettings } = await import("./settings");

    await db.delete(settings);
    const loaded = await loadSettings();
    expect(loaded.haUrl).toBe("http://ha.seed.test:8123");
    expect(loaded.haWebhookId).toBe("seed-hook");
  });
});
