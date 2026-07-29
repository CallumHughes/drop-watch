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

  it("emails only the owner, even with other verified accounts present", async () => {
    const ownerId = await insertUser({
      email: "owner@example.com",
      emailAlertsEnabled: true,
      emailVerified: true,
    });
    await insertUser({ email: "bystander@example.com", emailVerified: true });
    const current = await loadSettings();

    const targets = await alertTargets({ emailConfigured: true, ownerId, settings: current });
    expect(targets.recipients).toEqual(["owner@example.com"]);
  });

  it("sends no email when the owner's toggle is off", async () => {
    const ownerId = await insertUser({ email: "owner@example.com", emailVerified: true });
    const current = await loadSettings();

    const targets = await alertTargets({ emailConfigured: true, ownerId, settings: current });
    expect(targets.recipients).toEqual([]);
  });

  it("sends no email while the owner's address is unverified", async () => {
    const ownerId = await insertUser({
      email: "owner@example.com",
      emailAlertsEnabled: true,
      emailVerified: false,
    });
    const current = await loadSettings();

    const targets = await alertTargets({ emailConfigured: true, ownerId, settings: current });
    expect(targets.recipients).toEqual([]);
  });

  it("sends no email without a configured mailer, even with a willing owner", async () => {
    const ownerId = await insertUser({
      email: "owner@example.com",
      emailAlertsEnabled: true,
      emailVerified: true,
    });
    const current = await loadSettings();

    const targets = await alertTargets({ emailConfigured: false, ownerId, settings: current });
    expect(targets.recipients).toEqual([]);
  });

  it("silences both channels when the master switch is off", async () => {
    const ownerId = await insertUser({
      email: "owner@example.com",
      emailAlertsEnabled: true,
      emailVerified: true,
      role: "admin",
    });
    const current = await saveSettings({
      alertsEnabled: false,
      haUrl: "http://ha.local:8123",
      haWebhookId: "hook",
    });

    const targets = await alertTargets({ emailConfigured: true, ownerId, settings: current });
    expect(targets).toEqual({ recipients: [], webhook: null });
  });

  it("builds the webhook half for an admin owner from the two HA columns", async () => {
    const ownerId = await insertUser({ email: "admin@example.com", role: "admin" });
    const current = await saveSettings({
      haUrl: "http://ha.local:8123",
      haWebhookId: "hook",
    });

    const targets = await alertTargets({ emailConfigured: false, ownerId, settings: current });
    expect(targets.webhook).toEqual({ haUrl: "http://ha.local:8123", webhookId: "hook" });
  });

  it("leaves the webhook null for a plain owner even with HA configured", async () => {
    const ownerId = await insertUser({ email: "plain@example.com", role: "user" });
    const current = await saveSettings({
      haUrl: "http://ha.local:8123",
      haWebhookId: "hook",
    });

    const targets = await alertTargets({ emailConfigured: false, ownerId, settings: current });
    expect(targets.webhook).toBeNull();
  });

  it("leaves the webhook null while HA is only half-configured, admin or not", async () => {
    const ownerId = await insertUser({ email: "admin@example.com", role: "admin" });
    const current = await saveSettings({ haUrl: "http://ha.local:8123" });
    expect(notifyConfig(current)).toBeNull();

    const targets = await alertTargets({ emailConfigured: false, ownerId, settings: current });
    expect(targets.webhook).toBeNull();
  });

  it("goes quiet on an unknown owner (deletion racing an in-flight check)", async () => {
    const current = await saveSettings({
      haUrl: "http://ha.local:8123",
      haWebhookId: "hook",
    });

    const targets = await alertTargets({
      emailConfigured: true,
      ownerId: crypto.randomUUID(),
      settings: current,
    });
    expect(targets).toEqual({ recipients: [], webhook: null });
  });
});
