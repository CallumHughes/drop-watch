import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { closeDb, insertUser, resetSettings, truncateUsers } from "../test/helpers";
import { db } from "./index";
import { SETTINGS_ID, settings } from "./schema/settings";
import { alertTargets, loadSettings, notifyConfig, saveSettings } from "./settings";

const CONCURRENT_LOADS = 8;

afterAll(async () => {
  await closeDb();
});

describe("loadSettings", () => {
  beforeEach(async () => {
    await resetSettings();
  });

  it("seeds the defaults on an empty database (env unset)", async () => {
    const loaded = await loadSettings();
    expect(loaded).toMatchObject({
      alertsEnabled: true,
      cooldownMinutes: 720,
      emailAlertsEnabled: false,
      failureThreshold: 5,
      haUrl: null,
      haWebhookId: null,
      id: SETTINGS_ID,
    });
  });

  it("resolves a concurrent seeding race to a single row", async () => {
    const results = await Promise.all(
      Array.from({ length: CONCURRENT_LOADS }, () => loadSettings())
    );
    for (const result of results) {
      expect(result.id).toBe(SETTINGS_ID);
    }
    const rows = await db.select().from(settings);
    expect(rows).toHaveLength(1);
  });

  it("returns the existing row untouched on later reads", async () => {
    await saveSettings({ cooldownMinutes: 60 });
    const loaded = await loadSettings();
    expect(loaded.cooldownMinutes).toBe(60);
  });
});

describe("saveSettings", () => {
  beforeEach(async () => {
    await resetSettings();
  });

  it("creates the row first when patching an empty database", async () => {
    const saved = await saveSettings({ failureThreshold: 3 });
    expect(saved.failureThreshold).toBe(3);
    const rows = await db.select().from(settings);
    expect(rows).toHaveLength(1);
  });

  it("patches only the given columns", async () => {
    await saveSettings({ haUrl: "http://ha.local:8123", haWebhookId: "hook" });
    const saved = await saveSettings({ cooldownMinutes: 60 });
    expect(saved).toMatchObject({
      alertsEnabled: true,
      cooldownMinutes: 60,
      haUrl: "http://ha.local:8123",
      haWebhookId: "hook",
    });
  });
});

describe("settings_singleton constraint", () => {
  it("rejects any row with an id other than 1", async () => {
    // Drizzle wraps the pg error; the constraint name lives on the cause.
    await expect(db.insert(settings).values({ id: 2 })).rejects.toMatchObject({
      cause: expect.objectContaining({ constraint: "settings_singleton" }),
    });
  });
});

describe("alertTargets", () => {
  beforeEach(async () => {
    await resetSettings();
    await truncateUsers();
  });

  it("emails verified accounts when the channel is on and a mailer exists", async () => {
    await insertUser({ email: "verified@example.com", emailVerified: true });
    await insertUser({ email: "unverified@example.com", emailVerified: false });
    const current = await saveSettings({ emailAlertsEnabled: true });

    const targets = await alertTargets({ emailConfigured: true, settings: current });
    expect(targets.recipients).toEqual(["verified@example.com"]);
  });

  it("sends no email without a configured mailer, even with verified accounts", async () => {
    await insertUser({ email: "verified@example.com", emailVerified: true });
    const current = await saveSettings({ emailAlertsEnabled: true });

    const targets = await alertTargets({ emailConfigured: false, settings: current });
    expect(targets.recipients).toEqual([]);
  });

  it("sends no email when the toggle is off", async () => {
    await insertUser({ email: "verified@example.com", emailVerified: true });
    const current = await loadSettings();

    const targets = await alertTargets({ emailConfigured: true, settings: current });
    expect(targets.recipients).toEqual([]);
  });

  it("builds the webhook half from the two HA columns", async () => {
    const current = await saveSettings({
      haUrl: "http://ha.local:8123",
      haWebhookId: "hook",
    });

    const targets = await alertTargets({ emailConfigured: false, settings: current });
    expect(targets.webhook).toEqual({ haUrl: "http://ha.local:8123", webhookId: "hook" });
  });

  it("leaves the webhook null while HA is only half-configured", async () => {
    const current = await saveSettings({ haUrl: "http://ha.local:8123" });
    expect(notifyConfig(current)).toBeNull();
  });

  it("silences both channels when the master switch is off", async () => {
    await insertUser({ email: "verified@example.com", emailVerified: true });
    const current = await saveSettings({
      alertsEnabled: false,
      emailAlertsEnabled: true,
      haUrl: "http://ha.local:8123",
      haWebhookId: "hook",
    });

    const targets = await alertTargets({ emailConfigured: true, settings: current });
    expect(targets).toEqual({ recipients: [], webhook: null });
  });
});
