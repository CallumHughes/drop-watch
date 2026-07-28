/**
 * Instance-wide configuration: where alerts go, and how noisy they are allowed
 * to be.
 *
 * A table rather than environment variables, because the settings page has to
 * be able to *write* it — env-only config would make that page a read-only
 * display of something you still have to edit a compose file to change
 * (EPICS.md, Epic 7). The environment still gets the first word: on first boot
 * the row is created from `HA_URL` / `HA_WEBHOOK_ID`, after which the UI owns
 * it.
 *
 * Exactly one row, pinned to id 1 and held there by a check constraint. A
 * key/value table would have been more flexible and less typed; there is one
 * instance, so flexibility buys nothing here.
 */

import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** The only id the table will accept. */
export const SETTINGS_ID = 1;

/** 12 hours, per PLAN.md §6. Mirrors `DEFAULT_COOLDOWN_MINUTES` in core. */
const DEFAULT_COOLDOWN_MINUTES = 720;

/** Consecutive non-`ok` checks before a product is declared broken. */
const DEFAULT_FAILURE_THRESHOLD = 5;

export const settings = pgTable(
  "settings",
  {
    /** Master switch. Off means nothing is sent, and no dedupe state is written. */
    alertsEnabled: boolean("alerts_enabled").default(true).notNull(),
    /** Per `(productId, rule)` quiet period after an alert fires. */
    cooldownMinutes: integer("cooldown_minutes").default(DEFAULT_COOLDOWN_MINUTES).notNull(),
    /**
     * Whether alerts are also emailed to the verified account addresses.
     *
     * Its own column rather than "email is configured", because those are
     * different questions: `RESEND_API_KEY` says a mailer *exists*, this says
     * you want alerts through it. Default `false` so an install that gains a
     * key does not silently start mailing people — and so applying this
     * migration to a running tracker changes nothing until somebody ticks the
     * box. `alertsEnabled` still overrules it; Home Assistant is gated by its
     * own two columns being set, this channel by this one.
     */
    emailAlertsEnabled: boolean("email_alerts_enabled").default(false).notNull(),
    /** Consecutive failures before the "tracker broken" alert fires. */
    failureThreshold: integer("failure_threshold").default(DEFAULT_FAILURE_THRESHOLD).notNull(),
    /** Base URL of Home Assistant. Null until configured — nothing is sent. */
    haUrl: text("ha_url"),
    /** Webhook id. It is the secret; `local_only: true` keeps it LAN-bound. */
    haWebhookId: text("ha_webhook_id"),
    id: integer("id").primaryKey().default(SETTINGS_ID),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [check("settings_singleton", sql`${table.id} = 1`)]
);

export type Settings = typeof settings.$inferSelect;
export type NewSettings = typeof settings.$inferInsert;
