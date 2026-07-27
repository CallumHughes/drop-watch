/**
 * Reading and writing the singleton settings row.
 *
 * Both `apps/web` (the settings page) and `apps/worker` (every alert it sends)
 * come through here, which is the point: Postgres is the only interface
 * between them (PLAN.md §1), so a webhook URL changed in the UI takes effect on
 * the worker's very next check with nothing to restart and nothing to notify.
 */

import type { NotifyConfig } from "@price-tracker/core/notify";
import { env } from "@price-tracker/env/db";
import { eq } from "drizzle-orm";

import { db } from "./index";
import { type NewSettings, SETTINGS_ID, type Settings, settings } from "./schema/settings";

/** The columns the settings page may change. */
export type SettingsPatch = Partial<
  Pick<
    NewSettings,
    "alertsEnabled" | "cooldownMinutes" | "failureThreshold" | "haUrl" | "haWebhookId"
  >
>;

function readRow(): Promise<Settings | undefined> {
  return db
    .select()
    .from(settings)
    .where(eq(settings.id, SETTINGS_ID))
    .limit(1)
    .then((rows) => rows[0]);
}

/**
 * The settings row, created from the environment on first read.
 *
 * `onConflictDoNothing` rather than a transaction: web and worker both boot
 * against the same database and may well race here, and the loser of that race
 * wants the winner's row, not an error. Seeding happens once — every later call
 * is a single indexed read.
 */
export async function loadSettings(): Promise<Settings> {
  const existing = await readRow();
  if (existing) {
    return existing;
  }

  const seed: NewSettings = { id: SETTINGS_ID };
  if (env.HA_URL) {
    seed.haUrl = env.HA_URL;
  }
  if (env.HA_WEBHOOK_ID) {
    seed.haWebhookId = env.HA_WEBHOOK_ID;
  }
  await db.insert(settings).values(seed).onConflictDoNothing({ target: settings.id });

  const seeded = await readRow();
  if (!seeded) {
    throw new Error("settings row could not be created");
  }
  return seeded;
}

/** Applies a patch to the singleton row, creating it first if it is missing. */
export async function saveSettings(patch: SettingsPatch): Promise<Settings> {
  await loadSettings();
  const [updated] = await db
    .update(settings)
    .set(patch)
    .where(eq(settings.id, SETTINGS_ID))
    .returning();
  if (!updated) {
    throw new Error("settings row disappeared during update");
  }
  return updated;
}

/**
 * The destination for a notification, or `null` when alerting is switched off
 * or only half-configured. A `null` here is the difference between "we chose
 * not to send" and "we tried and failed" — the caller logs them differently.
 */
export function notifyConfig(current: Settings): NotifyConfig | null {
  if (!(current.alertsEnabled && current.haUrl && current.haWebhookId)) {
    return null;
  }
  return { haUrl: current.haUrl, webhookId: current.haWebhookId };
}
