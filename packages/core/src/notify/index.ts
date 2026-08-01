/**
 * The Home Assistant webhook client.
 *
 * Webhooks need no auth token — the webhook id *is* the secret, and
 * `local_only: true` keeps it LAN-bound. The payload is the shape the plan
 * specifies, sent as JSON to `${haUrl}/api/webhook/${webhookId}`.
 *
 * The one rule that matters here: **a notification failure must never fail a
 * check**. Home Assistant being down is not a reason to lose a price point or
 * to burn a pg-boss retry, so nothing in this module throws — every outcome
 * comes back as a result the caller logs and moves on from.
 */

import { request } from "undici";

import type { AlertRule } from "../rules/index";

/** Default budget for one webhook call. Home Assistant is on the LAN. */
const DEFAULT_TIMEOUT_MS = 5000;

const HTTP_BAD_REQUEST = 400;

/**
 * What a notification is about. The three alert rules, the synthetic
 * "this watch is broken" alarm, and `test` from the settings page's button.
 */
export type NotificationKind = AlertRule | "test" | "watch_broken";

/**
 * The webhook body.
 *
 * Every field is always present, `null` where it does not apply, so a Home
 * Assistant template can address `trigger.json.previousPrice` without first
 * checking that it exists. `price`/`previousPrice` stay decimal strings all the
 * way from `numeric(12,2)` — a price is never a float on this wire either.
 *
 * `consecutiveFailures` and `error` are the two additions to the plan's shape,
 * carrying the detail a `watch_broken` notification is useless without.
 */
export interface NotificationPayload {
  /** Length of the failure streak on a `watch_broken` alert; else null. */
  consecutiveFailures: number | null;
  currency: string | null;
  /** Failure detail on a `watch_broken` alert; else null. */
  error: string | null;
  imageUrl: string | null;
  inStock: boolean | null;
  /** Null only for the settings page's test notification, which has no listing. */
  listingId: string | null;
  /** Signed change from `previousPrice` to `price`, one decimal place. */
  pctChange: string | null;
  previousPrice: string | null;
  price: string | null;
  productId: string;
  rule: NotificationKind;
  title: string | null;
  url: string;
}

/** Where to send. Both halves must be set before anything is sent at all. */
export interface NotifyConfig {
  haUrl: string;
  timeoutMs?: number;
  webhookId: string;
}

export type NotifyResult =
  | { httpStatus: number; ok: true }
  | { error: string; httpStatus?: number; ok: false };

/**
 * Builds the endpoint, tolerating a trailing slash on the configured base URL.
 * Throws only on a base URL that is not a URL at all — {@link sendNotification}
 * catches that for you.
 */
export function webhookUrl(haUrl: string, webhookId: string): string {
  return new URL(`/api/webhook/${encodeURIComponent(webhookId)}`, haUrl).toString();
}

/**
 * POSTs one notification. Never throws and never rejects: a bad URL, a refused
 * connection, a timeout and a 500 all come back as `{ ok: false }`.
 *
 * A non-2xx response is reported as a failure so it lands in the log, but Home
 * Assistant answers 200 to a webhook whose automation does not exist, so a
 * "successful" send is not proof that anything happened at the other end. That
 * is what the settings page's test button is for.
 */
export async function sendNotification(
  config: NotifyConfig,
  payload: NotificationPayload
): Promise<NotifyResult> {
  let endpoint: string;
  try {
    endpoint = webhookUrl(config.haUrl, config.webhookId);
  } catch {
    return { error: `invalid Home Assistant URL: ${config.haUrl}`, ok: false };
  }

  try {
    const response = await request(endpoint, {
      body: JSON.stringify(payload),
      bodyTimeout: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      headers: { "content-type": "application/json" },
      headersTimeout: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      method: "POST",
    });
    // The body is never useful, but it must be drained or the connection leaks.
    await response.body.dump();
    if (response.statusCode >= HTTP_BAD_REQUEST) {
      return {
        error: `Home Assistant returned HTTP ${response.statusCode}`,
        httpStatus: response.statusCode,
        ok: false,
      };
    }
    return { httpStatus: response.statusCode, ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), ok: false };
  }
}
