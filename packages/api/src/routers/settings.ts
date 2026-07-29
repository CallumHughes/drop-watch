/**
 * Settings, split by who they belong to. The shared plumbing — the master
 * switch, cooldown, failure threshold, Home Assistant webhook — is one row
 * that steers alerting for the whole instance, so it is admin-only. Whether
 * your alerts are emailed to you is nobody's business but yours, so the
 * email toggle lives on the `user` row and every signed-in account gets its
 * own pair of procedures for it.
 *
 * The settings row is still the single source of truth for both apps — the
 * worker reads it on every check — so a webhook changed here takes effect
 * immediately with nothing to restart (PLAN.md §1: Postgres is the interface).
 */

import type { ChannelResult } from "@price-tracker/core/notify/channels";
import { deliverAlert } from "@price-tracker/core/notify/channels";
import { alertChannels } from "@price-tracker/core/notify/targets";
import { db } from "@price-tracker/db";
import { user } from "@price-tracker/db/schema/auth";
import { products } from "@price-tracker/db/schema/products";
import type { Settings } from "@price-tracker/db/schema/settings";
import {
  alertTargets,
  loadSettings,
  type SettingsPatch,
  saveSettings,
} from "@price-tracker/db/settings";
import { emailChannel, emailEnabled } from "@price-tracker/email";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { adminProcedure, protectedProcedure } from "../index";
import { settingsUpdateInput } from "../schemas/settings";

/**
 * Re-exported so `apps/web` can name the row without depending on
 * `@price-tracker/db` — the UI reads the API, not the database.
 */
export type { Settings } from "@price-tracker/db/schema/settings";

/** Only the keys actually supplied, so omitting a field leaves it alone. */
function buildPatch(input: z.infer<typeof settingsUpdateInput>): SettingsPatch {
  const patch: SettingsPatch = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      Object.assign(patch, { [key]: value });
    }
  }
  return patch;
}

/**
 * The requester's slice of alerting config: whether alerts for their products
 * are emailed to them. A shape rather than a bare boolean so growing it later
 * (digest frequency, quiet hours) is additive.
 */
export interface EmailPrefs {
  emailAlertsEnabled: boolean;
}

/**
 * What the "send test" button reports back, one row per *attempted* channel.
 *
 * It is `ChannelResult` unchanged rather than a parallel type, because the
 * page is showing exactly what the worker would have logged — a second shape
 * would only be a chance for the two to drift. Each row carries its `target`,
 * so "ok" says which inbox or which webhook URL it was ok for.
 */
export type TestResult = ChannelResult;

export const settingsRouter = {
  /** The signed-in account's own email-alert toggle, nobody else's. */
  emailPrefs: protectedProcedure.handler(async ({ context }): Promise<EmailPrefs> => {
    const [row] = await db
      .select({ emailAlertsEnabled: user.emailAlertsEnabled })
      .from(user)
      .where(eq(user.id, context.session.user.id))
      .limit(1);
    if (!row) {
      throw new Error("session user row disappeared");
    }
    return row;
  }),

  get: adminProcedure.handler((): Promise<Settings> => loadSettings()),

  /**
   * Fires a notification shaped exactly like a real alert, resolved for the
   * requester: a non-admin's test exercises exactly the channels their real
   * alerts would use (email only — the webhook is the admin's channel), while
   * the admin's exercises both. The sample product is the requester's own
   * oldest one, so the mail shows something they actually track. Home
   * Assistant answers 200 to a webhook with no automation behind it, so a
   * green webhook row proves the URL and the webhook id are right — not that
   * your phone will buzz.
   *
   * An **empty array is not a failure**: it means nothing is configured to
   * receive alerts for this account, which is a state to describe rather than
   * an error to report. The page renders it as such.
   */
  sendTest: protectedProcedure.handler(async ({ context }): Promise<TestResult[]> => {
    const current = await loadSettings();
    const targets = await alertTargets({
      emailConfigured: emailEnabled(),
      ownerId: context.session.user.id,
      settings: current,
    });
    // The same assembly the worker uses, so a test send attempts exactly the
    // channels a real alert would — including attempting none.
    const channels = alertChannels(targets, emailChannel);
    if (channels.length === 0) {
      return [];
    }

    const [sample] = await db
      .select()
      .from(products)
      .where(eq(products.userId, context.session.user.id))
      .orderBy(asc(products.createdAt))
      .limit(1);
    const { results } = await deliverAlert({
      channels,
      payload: {
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
      },
    });
    return results;
  }),

  update: adminProcedure
    .input(settingsUpdateInput)
    .handler(async ({ input }): Promise<Settings> => {
      const patch = buildPatch(input);
      return Object.keys(patch).length === 0 ? await loadSettings() : await saveSettings(patch);
    }),

  /** Flips the requester's own toggle; it can touch no other row. */
  updateEmailPrefs: protectedProcedure
    .input(z.object({ emailAlertsEnabled: z.boolean() }))
    .handler(async ({ context, input }): Promise<EmailPrefs> => {
      const [updated] = await db
        .update(user)
        .set({ emailAlertsEnabled: input.emailAlertsEnabled })
        .where(eq(user.id, context.session.user.id))
        .returning({ emailAlertsEnabled: user.emailAlertsEnabled });
      if (!updated) {
        throw new Error("session user row disappeared during update");
      }
      return updated;
    }),
};
