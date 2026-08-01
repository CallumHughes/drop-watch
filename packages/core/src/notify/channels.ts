/**
 * The fan-out seam: one alert, zero or more channels.
 *
 * Alerting started with exactly one destination, so "send the alert" and "POST
 * the webhook" were the same sentence. Email makes them two, and this module is
 * the joint. It knows how to run a list of channels and report what happened; it
 * does not know that one of them is Resend, because a channel is *injected* as
 * a `send` function. That is what keeps `@drop-watch/core` free of both
 * Resend and React — the same injection trick `jitteredIntervalMs` uses in
 * `apps/worker/src/schedule.ts`, here for decoupling rather than testability,
 * though it buys that too.
 *
 * Two rules carried over from `sendNotification`, and one new one:
 *
 * - Nothing here throws. A channel that rejects is reported as a failed
 *   channel, never as an exception the caller has to catch.
 * - Channels are independent. Home Assistant being down must not cost you the
 *   email, and vice versa, so they run concurrently and are reported
 *   separately.
 * - **An unconfigured channel is absent from the array, not a channel that
 *   fails.** Zero channels is a quiet, legitimate outcome — "nothing was
 *   configured" — and must never be logged or rendered as a delivery failure.
 */

import type { NotificationPayload, NotifyConfig } from "./index";
import { sendNotification, webhookUrl } from "./index";

/** The channels an alert can go out on. */
export type ChannelName = "discord" | "email" | "ntfy" | "telegram" | "webhook";

/**
 * One configured destination.
 *
 * `send` is supplied by whoever built the channel, which is how the email
 * transport reaches this module without core depending on it. Implementations
 * are expected not to throw; {@link deliverAlert} catches anyway, because a
 * contract that is only documented is a contract that eventually breaks.
 */
export interface AlertChannel {
  name: ChannelName;
  send: (payload: NotificationPayload) => Promise<ChannelSendResult>;
  /** Where it went, for the log line and the settings page's test rows. */
  target: string;
}

/** What a channel's `send` reports. Deliberately the shape of `NotifyResult`. */
export type ChannelSendResult =
  | { httpStatus?: number; ok: true }
  | { error: string; httpStatus?: number; ok: false };

/**
 * Everything that is configured to receive alerts, resolved from the settings
 * row and the `user` table.
 *
 * The type lives here rather than in `@drop-watch/db` so that
 * `@drop-watch/email` — which turns targets into channels — can name it
 * without depending on the database, and so that "what counts as configured"
 * has one definition both the worker and the settings page read.
 */
export interface AlertTargets {
  /** Webhook URL, or `null` when alerting is off or Discord isn't set up. */
  discord: string | null;
  /** `null` when alerting is off or ntfy is half-configured. */
  ntfy: { token: string | null; url: string } | null;
  /** Verified account addresses, or empty when email alerting is off. */
  recipients: string[];
  /** `null` when alerting is off or Telegram is half-configured. */
  telegram: { botToken: string; chatId: string } | null;
  /** `null` when alerting is off or Home Assistant is half-configured. */
  webhook: NotifyConfig | null;
}

/** One channel's outcome, fully populated so a caller never has to guard. */
export interface ChannelResult {
  /** Failure detail, or `null` when it landed. */
  error: string | null;
  httpStatus: number | null;
  name: ChannelName;
  ok: boolean;
  target: string;
}

/**
 * Whether anything landed, plus the per-channel detail.
 *
 * `delivered` is the bit `apps/worker/src/alerting.ts` gates `alert_state` on —
 * "any channel landed" — and it is `false` for an empty channel list, since
 * nothing was delivered. The caller distinguishes the two by the length of
 * `results`, which is why the detail rides along rather than being logged here:
 * the settings page renders one row per attempted channel from exactly this.
 */
export interface DeliveryOutcome {
  delivered: boolean;
  results: ChannelResult[];
}

export interface DeliverAlertInput {
  /** Only *configured* channels. An empty list means nothing was set up. */
  channels: readonly AlertChannel[];
  payload: NotificationPayload;
}

/** Wraps one channel so a rejection becomes a result rather than an exception. */
async function runChannel(
  channel: AlertChannel,
  payload: NotificationPayload
): Promise<ChannelResult> {
  try {
    const result = await channel.send(payload);
    return result.ok
      ? {
          error: null,
          httpStatus: result.httpStatus ?? null,
          name: channel.name,
          ok: true,
          target: channel.target,
        }
      : {
          error: result.error,
          httpStatus: null,
          name: channel.name,
          ok: false,
          target: channel.target,
        };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      httpStatus: null,
      name: channel.name,
      ok: false,
      target: channel.target,
    };
  }
}

/**
 * Sends one payload on every configured channel and reports each separately.
 *
 * Concurrent rather than sequential: the channels are independent, and a
 * webhook timing out against an unplugged Home Assistant should not delay the
 * email by five seconds.
 */
export async function deliverAlert({
  channels,
  payload,
}: DeliverAlertInput): Promise<DeliveryOutcome> {
  const results = await Promise.all(channels.map((channel) => runChannel(channel, payload)));
  return { delivered: results.some((result) => result.ok), results };
}

/**
 * The Home Assistant channel. Lives here because core already owns the
 * transport; the email channel is built in `@drop-watch/email` for the
 * mirror-image reason.
 */
export function webhookChannel(config: NotifyConfig): AlertChannel {
  let target: string;
  try {
    target = webhookUrl(config.haUrl, config.webhookId);
  } catch {
    // An unusable base URL is still a configured channel — the user asked for
    // it, so it must be reported as a failure rather than silently dropped.
    target = config.haUrl;
  }
  return {
    name: "webhook",
    send: (payload) => sendNotification(config, payload),
    target,
  };
}
