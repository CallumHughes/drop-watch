/**
 * Domain schema: the tracked products, their observed prices, the audit trail of
 * every check attempt, and the per-rule alert dedupe state.
 *
 * Money is `numeric(12,2)` everywhere and surfaces in TypeScript as a decimal
 * string. Never a float, and never round-tripped through `Number`.
 */

import type { AlertRule } from "@drop-watch/core/rules";
import { relations, sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  char,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

/** `auto` runs the full fallback chain; `selector` forces the configured CSS selector. */
export const extractorMode = pgEnum("extractor_mode", ["auto", "selector"]);

/** Plain HTTP today. `browser` is reserved for a headless renderer we have not built. */
export const renderMode = pgEnum("render_mode", ["http", "browser"]);

/**
 * Outcome of one check attempt.
 *
 * Maps onto the fetch layer's result union (`@drop-watch/core/fetch`):
 *
 * | fetch result    | check run                                             |
 * | --------------- | ----------------------------------------------------- |
 * | `ok` + price    | `ok`                                                  |
 * | `ok` + no price | `extract_failed`                                      |
 * | `not_modified`  | `ok`, `httpStatus` 304, `extractorUsed` null          |
 * | `http_error`    | `http_error`                                          |
 * | `network_error` | `network_error`                                       |
 * | `timeout`       | `timeout`                                             |
 *
 * `network_error` is deliberately its own value rather than folded into
 * `http_error`: an origin answering 503 and a hostname that no longer resolves
 * are different faults with different fixes, and telling them apart is the whole
 * point of keeping this table. `not_modified` is not a status of its own because
 * a 304 is a *successful* check — giving it its own value would make the
 * consecutive-failure alarm in Epic 7 fire on a perfectly healthy product.
 */
export const checkRunStatus = pgEnum("check_run_status", [
  "ok",
  "extract_failed",
  "http_error",
  "network_error",
  "timeout",
]);

/** Which link in the extraction chain produced a price. Mirrors `ExtractorStrategy`. */
export type ExtractorUsed = "jsonld" | "microdata" | "opengraph" | "selector";

/** `alertState` also tracks the synthetic "this watch is broken" notification. */
export type AlertStateRule = AlertRule | "watch_broken";

export const products = pgTable(
  "products",
  {
    /** Paused products are skipped by the dispatcher regardless of nextCheckAt. */
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    /** ISO 4217, learned from the first successful extraction. */
    currency: char("currency", { length: 3 }),
    /** Alert when the price falls at least this far below the previous point. */
    dropPercent: integer("drop_percent"),
    /** Conditional-request cache validators from the last successful fetch. */
    etag: text("etag"),
    extractor: extractorMode("extractor").default("auto").notNull(),
    id: uuid("id").primaryKey().defaultRandom(),
    imageUrl: text("image_url"),
    intervalMinutes: integer("interval_minutes").default(180).notNull(),
    /** Spread of the reschedule, so products on one interval do not stampede. */
    jitterPercent: integer("jitter_percent").default(20).notNull(),
    lastModified: text("last_modified"),
    /** BCP 47 hint disambiguating `1.234` style prices. */
    locale: text("locale"),
    nextCheckAt: timestamp("next_check_at", { withTimezone: true }).defaultNow().notNull(),
    render: renderMode("render").default("http").notNull(),
    /** Enabled alert rules, e.g. `['target','restock']`. */
    rules: text("rules").array().$type<AlertRule[]>().default(sql`'{}'::text[]`).notNull(),
    /** CSS selector used when `extractor = 'selector'`. */
    selector: text("selector"),
    targetPrice: numeric("target_price", { precision: 12, scale: 2 }),
    title: text("title"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    url: text("url").notNull(),
    /**
     * The owning account. Cascade, not restrict: the Better Auth admin plugin
     * can remove users, and a removed user's products (and their price points,
     * check runs and alert state, which cascade off `productId`) go with them.
     * Uniqueness is per `(userId, url)` — two users tracking the same URL is
     * two rows and two fetches, accepted as the cost of privacy.
     */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    // The dispatcher runs this exact predicate every minute.
    index("products_active_next_check_at_idx").on(table.active, table.nextCheckAt),
    // Leading user_id also serves every owner-scoped list query, so no
    // separate plain index on userId is needed.
    unique("products_user_id_url_unique").on(table.userId, table.url),
  ]
);

/**
 * One row per successful check, not only per change — stock-status history is
 * useful and the volume is trivial.
 */
export const pricePoints = pgTable(
  "price_points",
  {
    /** Bare schema.org token, e.g. "InStock". Kept for restock-alert debugging. */
    availability: text("availability"),
    currency: char("currency", { length: 3 }).notNull(),
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** Null when the page stated no availability we recognise. */
    inStock: boolean("in_stock"),
    observedAt: timestamp("observed_at", { withTimezone: true }).defaultNow().notNull(),
    /** Decimal string in TypeScript. */
    price: numeric("price", { precision: 12, scale: 2 }).notNull(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
  },
  (table) => [
    // Powers every chart query and the "previous price" lookup.
    index("price_points_product_id_observed_at_idx").on(table.productId, table.observedAt.desc()),
  ]
);

/**
 * One row per attempt, including failures. This table is what makes "why did
 * this silently stop working" answerable. Retain ~30 days, enforced by the
 * worker's daily purge job (`apps/worker/src/purge-check-runs.ts`).
 */
export const checkRuns = pgTable(
  "check_runs",
  {
    durationMs: integer("duration_ms"),
    /** Failure detail; null on success. */
    error: text("error"),
    /** Null when no extraction ran (304, transport failure). */
    extractorUsed: text("extractor_used").$type<ExtractorUsed>(),
    /** Null when the request never got a response. */
    httpStatus: integer("http_status"),
    id: bigserial("id", { mode: "number" }).primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    status: checkRunStatus("status").notNull(),
  },
  (table) => [
    // Detail-page log, and the consecutive-failure window Epic 7 reads.
    index("check_runs_product_id_started_at_idx").on(table.productId, table.startedAt.desc()),
    // The retention sweep's predicate; the composite above cannot serve it.
    index("check_runs_started_at_idx").on(table.startedAt),
  ]
);

/**
 * Alert dedupe, keyed by `(productId, rule)`. Without this a product sitting a
 * pound under target notifies every interval, forever.
 */
export const alertState = pgTable(
  "alert_state",
  {
    lastAlertedAt: timestamp("last_alerted_at", { withTimezone: true }),
    lastAlertedPrice: numeric("last_alerted_price", { precision: 12, scale: 2 }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    rule: text("rule").$type<AlertStateRule>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.productId, table.rule] })]
);

export const productsRelations = relations(products, ({ many, one }) => ({
  alertStates: many(alertState),
  checkRuns: many(checkRuns),
  owner: one(user, {
    fields: [products.userId],
    references: [user.id],
  }),
  pricePoints: many(pricePoints),
}));

export const pricePointsRelations = relations(pricePoints, ({ one }) => ({
  product: one(products, {
    fields: [pricePoints.productId],
    references: [products.id],
  }),
}));

export const checkRunsRelations = relations(checkRuns, ({ one }) => ({
  product: one(products, {
    fields: [checkRuns.productId],
    references: [products.id],
  }),
}));

export const alertStateRelations = relations(alertState, ({ one }) => ({
  product: one(products, {
    fields: [alertState.productId],
    references: [products.id],
  }),
}));

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type PricePoint = typeof pricePoints.$inferSelect;
export type NewPricePoint = typeof pricePoints.$inferInsert;
export type CheckRun = typeof checkRuns.$inferSelect;
export type NewCheckRun = typeof checkRuns.$inferInsert;
export type AlertStateRow = typeof alertState.$inferSelect;
export type NewAlertState = typeof alertState.$inferInsert;
