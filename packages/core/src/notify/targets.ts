/**
 * Configured destinations in, channels to try out.
 *
 * One rule, applied in one place, because getting it wrong is expensive and
 * invisible: **an unconfigured channel is absent from the array, not a channel
 * that fails.** `deliverAlert` reports every channel it is handed, so a channel
 * built for a destination nobody configured turns into a failure row — in the
 * worker's log on the back of every single alert, and in the settings page's
 * test results. A tracker with no mailer must behave exactly as it did before
 * email existed, and that property lives here.
 *
 * The email channel is *injected* for the same reason `channels.ts` injects
 * `send`: `@drop-watch/core` must not learn about Resend or React. It is a
 * separate module from `channels.ts` only because that file is the transport
 * seam and this is the policy on top of it.
 *
 * Both the worker (`apps/worker/src/alerting.ts`) and the settings page's test
 * button (`packages/api/src/routers/settings.ts`) come through here, which is
 * the point — a test send that reports channels the real alert would not have
 * tried is a test that proves nothing.
 */

import type { AlertChannel, AlertTargets } from "./channels";
import { webhookChannel } from "./channels";

/** Builds the email channel for a non-empty recipient list. */
export type EmailChannelFactory = (recipients: readonly string[]) => AlertChannel;

/**
 * The channels to attempt for a set of resolved targets, in the order they are
 * reported.
 *
 * Each half is gated on its own evidence of being configured, and the evidence
 * is the target itself: a `null` webhook and an empty recipient list both mean
 * "nothing was set up here". Whoever resolved the targets has already applied
 * the master switch, the toggles and the "is a mailer even installed" question
 * — see `alertTargets` in `@drop-watch/db/settings` — so there is nothing
 * left to second-guess.
 *
 * An empty result is a legitimate, quiet outcome: nothing is configured, so
 * nothing is attempted and nothing failed.
 */
export function alertChannels(
  targets: AlertTargets,
  emailChannel: EmailChannelFactory
): AlertChannel[] {
  const channels: AlertChannel[] = [];
  if (targets.webhook) {
    channels.push(webhookChannel(targets.webhook));
  }
  if (targets.recipients.length > 0) {
    channels.push(emailChannel(targets.recipients));
  }
  return channels;
}
