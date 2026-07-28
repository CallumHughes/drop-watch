/**
 * The Resend transport, and the one place the mailer's on/off switch is read.
 *
 * Email is opt-in and `RESEND_API_KEY` is the switch: setting it is the
 * statement "I want the mailer", and leaving it unset must leave a self-hoster
 * with a fully working, webhook-only tracker rather than a half-broken auth
 * flow. That decision only holds if the capability is decided in exactly one
 * place, so {@link emailEnabled} is it — no other module in the repo reads the
 * variable, and every branch that behaves differently with a mailer (Better
 * Auth's `requireEmailVerification`, the pages that would 404 without it, the
 * email alert channel) asks this function instead of re-deriving the answer
 * from the environment.
 *
 * {@link sendEmail} never throws. That is the same contract
 * `sendNotification` in `@price-tracker/core/notify` keeps, for the same
 * reason: a mail that could not be sent is a thing to log, never a thing that
 * fails the check, the sign-up or the request that triggered it. With no key
 * it short-circuits to `{ ok: false, error: EMAIL_NOT_CONFIGURED }`, which
 * callers can tell apart from a real failure exactly as `notifyConfig` in
 * `@price-tracker/db/settings` already separates "chose not to send" from
 * "tried and failed".
 */

import { env } from "@price-tracker/env/email";
import { render } from "@react-email/render";
import type { ReactElement } from "react";
import { Resend } from "resend";

/**
 * Resend's shared sender, which needs no verified domain but which Resend will
 * only deliver to the address that owns the account. That is enough for a
 * single-user tracker and useless for anything else, so `EMAIL_FROM` exists.
 */
const DEFAULT_FROM = "onboarding@resend.dev";

/**
 * The error a caller gets back when no key is configured. Exported because
 * "you never asked for a mailer" is a different outcome from "the mailer
 * broke", and callers are expected to render and log the two differently.
 */
export const EMAIL_NOT_CONFIGURED = "email is not configured";

/** Sent with no addresses at all — a caller bug, reported rather than thrown. */
export const EMAIL_NO_RECIPIENTS = "no recipients";

/**
 * The outcome of one send. `id` is Resend's message id, carried purely so a
 * log line can be correlated with the Resend dashboard; nothing branches on it.
 */
export type SendEmailResult = { id: string | null; ok: true } | { error: string; ok: false };

export interface SendEmailInput {
  /** The template element. Rendered to HTML *and* plain text before sending. */
  react: ReactElement;
  subject: string;
  to: readonly string[] | string;
}

/**
 * The key, or `null` when the mailer is switched off.
 *
 * Private on purpose: the value never leaves this module, so the only thing
 * the rest of the repo can learn is the boolean {@link emailEnabled} returns.
 */
function apiKey(): string | null {
  return env.RESEND_API_KEY ?? null;
}

/** Whether a mailer is configured. The single source of truth for that fact. */
export function emailEnabled(): boolean {
  return apiKey() !== null;
}

/** The `From:` address, falling back to Resend's no-domain-needed sender. */
export function emailFrom(): string {
  return env.EMAIL_FROM ?? DEFAULT_FROM;
}

/**
 * The absolute base URL of the app, or `null` when it was not configured.
 *
 * The worker has no `BETTER_AUTH_URL`, and an alert email whose "open the
 * dashboard" link is relative is an alert email with no link at all — so
 * templates take a possibly-`null` link and simply omit it when unset, rather
 * than rendering a dead one.
 */
export function appUrl(): string | null {
  return env.APP_URL ?? null;
}

/**
 * Constructed on first use rather than at import time, so that importing this
 * module — which `@price-tracker/auth` does unconditionally — costs nothing on
 * an install with no key, and so the process starts even when the key is
 * garbage. The instance is a thin HTTP wrapper and is safe to share.
 */
let client: Resend | null = null;

function resendClient(key: string): Resend {
  if (!client) {
    client = new Resend(key);
  }
  return client;
}

/**
 * Renders a template and sends it. Never throws and never rejects: a missing
 * key, an empty recipient list, a rejected API call and a network error all
 * come back as `{ ok: false }` with the detail in `error`.
 *
 * Both an HTML and a plain-text body are rendered. Text is not decoration —
 * some clients prefer it, spam filters hold a missing text part against you,
 * and it costs one more pass over an element that is already in memory.
 */
export async function sendEmail({ react, subject, to }: SendEmailInput): Promise<SendEmailResult> {
  const key = apiKey();
  if (key === null) {
    return { error: EMAIL_NOT_CONFIGURED, ok: false };
  }

  const recipients = typeof to === "string" ? [to] : [...to];
  if (recipients.length === 0) {
    return { error: EMAIL_NO_RECIPIENTS, ok: false };
  }

  try {
    const [html, text] = await Promise.all([render(react), render(react, { plainText: true })]);
    const { data, error } = await resendClient(key).emails.send({
      from: emailFrom(),
      html,
      subject,
      text,
      to: recipients,
    });
    if (error) {
      return { error: `${error.name}: ${error.message}`, ok: false };
    }
    return { id: data?.id ?? null, ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), ok: false };
  }
}
