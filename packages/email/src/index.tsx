/**
 * The package's public surface: one function per mail the app sends, plus the
 * seam that turns "send an alert" into an alert channel.
 *
 * Everything above this line is a template or a transport; everything that
 * calls it — Better Auth's callbacks in `@price-tracker/auth`, the worker's
 * fan-out in `apps/worker/src/alerting.ts` — should be able to say what it
 * wants in one line and get back a result it never has to catch. So each
 * function here pairs a template with its subject and hands the pair to
 * {@link sendEmail}, and none of them throws.
 *
 * {@link emailChannel} is the other half of that: it wraps `sendAlertEmail` in
 * the `AlertChannel` shape `@price-tracker/core/notify/channels` defines, which
 * is how the email transport reaches `deliverAlert` without `core` ever
 * importing Resend or React. Build the channel only when there is somebody to
 * send to — an unconfigured channel is *absent from the array*, never a channel
 * that fails, or "no mailer configured" would show up in the logs as a delivery
 * failure.
 */

/** @jsxRuntime automatic — see ./templates/layout.tsx for why this is here. */
/** @jsxImportSource react */

import type { NotificationPayload } from "@price-tracker/core/notify";
import type { AlertChannel, ChannelSendResult } from "@price-tracker/core/notify/channels";

import { appUrl, type SendEmailResult, sendEmail } from "./client";
import { CHANGE_EMAIL_SUBJECT, ChangeEmail } from "./templates/change-email";
import { PriceAlert, priceAlertSubject } from "./templates/price-alert";
import { RESET_PASSWORD_SUBJECT, ResetPassword } from "./templates/reset-password";
import { TrackerBroken, trackerBrokenSubject } from "./templates/tracker-broken";
import { VERIFY_EMAIL_SUBJECT, VerifyEmail } from "./templates/verify-email";

// `emailEnabled` is the switch every caller has to read, so it is surfaced on
// the entry point rather than leaving consumers to know it lives in `./client`:
// a consumer reaching past the entry point is a consumer one step away from
// reading `RESEND_API_KEY` for itself, which is the one thing this package
// exists to prevent.
// biome-ignore lint/performance/noBarrelFile: three named symbols, not a re-export of the world.
export { EMAIL_NOT_CONFIGURED, emailEnabled, type SendEmailResult } from "./client";

/** A Better Auth callback's mail: one recipient, one tokenised link. */
export interface AuthEmailInput {
  to: string;
  /** The one-time URL Better Auth generated. Passed through untouched. */
  url: string;
}

export interface ChangeEmailInput extends AuthEmailInput {
  /** The address being moved to. `to` stays the *current* one — see the template. */
  newEmail: string;
}

/**
 * Absolute link to a product's page in the tracker, or `null` when `APP_URL`
 * is unset. `null` rather than a relative path on purpose: the templates fall
 * back to the shop's own URL, which is at least clickable from an inbox.
 */
function trackerLink(productId: string): string | null {
  const base = appUrl();
  if (base === null) {
    return null;
  }
  try {
    return new URL(`/products/${encodeURIComponent(productId)}`, base).toString();
  } catch {
    // A malformed `APP_URL` costs the link, never the alert.
    return null;
  }
}

/** Sign-up verification. Without this the account cannot sign in. */
export function sendVerificationEmail({ to, url }: AuthEmailInput): Promise<SendEmailResult> {
  return sendEmail({ react: <VerifyEmail url={url} />, subject: VERIFY_EMAIL_SUBJECT, to });
}

/** Password reset — the only way back into a box whose signup has closed. */
export function sendPasswordResetEmail({ to, url }: AuthEmailInput): Promise<SendEmailResult> {
  return sendEmail({ react: <ResetPassword url={url} />, subject: RESET_PASSWORD_SUBJECT, to });
}

/**
 * Approval for a change of address. `to` is the address currently on the
 * account, not `newEmail`: only whoever already reads that inbox may hand the
 * account somewhere else.
 */
export function sendChangeEmailVerification({
  newEmail,
  to,
  url,
}: ChangeEmailInput): Promise<SendEmailResult> {
  return sendEmail({
    react: <ChangeEmail newEmail={newEmail} url={url} />,
    subject: CHANGE_EMAIL_SUBJECT,
    to,
  });
}

/**
 * One alert to every account address, in a single send — recipients are the
 * people who share the tracker, so there is nothing to hide between them and
 * one mail is cheaper than n.
 *
 * The payload's `rule` picks the template: `tracker_broken` says the opposite
 * thing from a price alert and gets its own.
 */
export function sendAlertEmail(
  recipients: readonly string[],
  payload: NotificationPayload
): Promise<SendEmailResult> {
  const trackerUrl = trackerLink(payload.productId);
  if (payload.rule === "tracker_broken") {
    return sendEmail({
      react: <TrackerBroken payload={payload} trackerUrl={trackerUrl} />,
      subject: trackerBrokenSubject(payload),
      to: recipients,
    });
  }
  return sendEmail({
    react: <PriceAlert payload={payload} trackerUrl={trackerUrl} />,
    subject: priceAlertSubject(payload),
    to: recipients,
  });
}

/**
 * The email channel, for `deliverAlert`.
 *
 * `target` is the recipient list because that is what the settings page's test
 * rows show and what the log line needs to be useful — "email: ok" without
 * saying whose inbox is a line that answers nothing.
 */
export function emailChannel(recipients: readonly string[]): AlertChannel {
  return {
    name: "email",
    send: async (payload): Promise<ChannelSendResult> => {
      const result = await sendAlertEmail(recipients, payload);
      return result.ok ? { ok: true } : { error: result.error, ok: false };
    },
    target: recipients.join(", "),
  };
}
