/**
 * Instance settings: where alerts go, how noisy they may be, and a button that
 * proves the whole path works before you wait three hours to find out it
 * doesn't.
 *
 * The row is the single source of truth for both apps — the worker reads it on
 * every check — so a webhook changed here takes effect immediately with nothing
 * to restart (PLAN.md §1: Postgres is the interface).
 */

import { sendNotification, webhookUrl } from "@price-tracker/core/notify";
import { db } from "@price-tracker/db";
import { products } from "@price-tracker/db/schema/products";
import type { Settings } from "@price-tracker/db/schema/settings";
import {
  loadSettings,
  notifyConfig,
  type SettingsPatch,
  saveSettings,
} from "@price-tracker/db/settings";
import { asc } from "drizzle-orm";
import { z } from "zod";

import { protectedProcedure } from "../index";

/**
 * Re-exported so `apps/web` can name the row without depending on
 * `@price-tracker/db` — the UI reads the API, not the database.
 */
export type { Settings } from "@price-tracker/db/schema/settings";

/** An hour is the shortest quiet period that is still quiet. */
const MIN_COOLDOWN_MINUTES = 60;
/** A week. Longer than this and you have switched the rule off, not tuned it. */
const MAX_COOLDOWN_MINUTES = 10_080;
const MIN_FAILURE_THRESHOLD = 2;
const MAX_FAILURE_THRESHOLD = 50;
const MAX_WEBHOOK_ID_LENGTH = 200;
const MAX_URL_LENGTH = 2048;

/**
 * Both Home Assistant fields are nullable so the page can clear them, which is
 * how you turn alerting off without also losing the cooldown you tuned.
 */
const updateInput = z.object({
  alertsEnabled: z.boolean().optional(),
  cooldownMinutes: z.number().int().min(MIN_COOLDOWN_MINUTES).max(MAX_COOLDOWN_MINUTES).optional(),
  failureThreshold: z
    .number()
    .int()
    .min(MIN_FAILURE_THRESHOLD)
    .max(MAX_FAILURE_THRESHOLD)
    .optional(),
  haUrl: z.url().max(MAX_URL_LENGTH).nullable().optional(),
  haWebhookId: z.string().min(1).max(MAX_WEBHOOK_ID_LENGTH).nullable().optional(),
});

/** Only the keys actually supplied, so omitting a field leaves it alone. */
function buildPatch(input: z.infer<typeof updateInput>): SettingsPatch {
  const patch: SettingsPatch = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      Object.assign(patch, { [key]: value });
    }
  }
  return patch;
}

/** What the "send test" button reports back. */
export interface TestResult {
  /** Present on failure. `null` when the send succeeded. */
  error: string | null;
  httpStatus: number | null;
  ok: boolean;
  /** Echoed so the page can show exactly where it went. */
  target: string | null;
}

function unconfigured(current: Settings): TestResult {
  const reason = current.alertsEnabled
    ? "Set a Home Assistant URL and webhook id first."
    : "Alerts are switched off.";
  return { error: reason, httpStatus: null, ok: false, target: null };
}

export const settingsRouter = {
  get: protectedProcedure.handler((): Promise<Settings> => loadSettings()),

  /**
   * Fires a notification shaped exactly like a real alert, against a real
   * tracked product where there is one. Home Assistant answers 200 to a webhook
   * with no automation behind it, so a green result here proves the URL and the
   * webhook id are right — not that your phone will buzz.
   */
  sendTest: protectedProcedure.handler(async (): Promise<TestResult> => {
    const current = await loadSettings();
    const config = notifyConfig(current);
    if (!config) {
      return unconfigured(current);
    }

    const [sample] = await db.select().from(products).orderBy(asc(products.createdAt)).limit(1);
    const target = webhookUrl(config.haUrl, config.webhookId);
    const result = await sendNotification(config, {
      consecutiveFailures: null,
      currency: sample?.currency ?? "GBP",
      error: null,
      imageUrl: sample?.imageUrl ?? null,
      inStock: true,
      pctChange: "-12.0",
      previousPrice: "63.00",
      price: "55.44",
      productId: sample?.id ?? "00000000-0000-0000-0000-000000000000",
      rule: "test",
      title: sample?.title ?? "Price tracker test",
      url: sample?.url ?? "https://example.com/",
    });

    return result.ok
      ? { error: null, httpStatus: result.httpStatus, ok: true, target }
      : { error: result.error, httpStatus: result.httpStatus ?? null, ok: false, target };
  }),

  update: protectedProcedure.input(updateInput).handler(async ({ input }): Promise<Settings> => {
    const patch = buildPatch(input);
    return Object.keys(patch).length === 0 ? await loadSettings() : await saveSettings(patch);
  }),
};
