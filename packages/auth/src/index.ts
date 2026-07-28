import { createDb } from "@price-tracker/db";
// biome-ignore lint/performance/noNamespaceImport: drizzle adapter requires the full schema object.
import * as schema from "@price-tracker/db/schema/auth";
import { signupOpen } from "@price-tracker/db/signup";
import {
  emailEnabled,
  type SendEmailResult,
  sendChangeEmailVerification,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "@price-tracker/email";
import { env } from "@price-tracker/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { createLogger } from "evlog";

/** The endpoint the guard below closes. */
const SIGN_UP_PATH = "/sign-up/email";

/**
 * Signup is open exactly until the first account exists.
 *
 * This tracker is single-user (PLAN.md §8): one seeded admin, and no way for
 * anyone reaching the LAN to add themselves afterwards. A live check rather
 * than the static `emailAndPassword.disableSignUp` flag, so a fresh install
 * that has not been seeded can still be bootstrapped from the login page — and
 * so the door shuts the moment it has been.
 *
 * Enforced here rather than only in the UI because hiding a form is not
 * security; the endpoint is what is actually exposed.
 */
const closeSignupAfterFirstUser = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== SIGN_UP_PATH) {
    return;
  }
  if (!(await signupOpen())) {
    throw new APIError("FORBIDDEN", {
      code: "SIGN_UP_DISABLED",
      message: "Signup is disabled. This tracker already has an account.",
    });
  }
});

/**
 * Sends one of Better Auth's transactional mails and turns a failure into a
 * failed request.
 *
 * This is the one place in the repo where a failed send is *not* swallowed.
 * The worker's rule — log it, never fail the check — is right for an alert,
 * because the alert is a side effect of work that already succeeded. Here the
 * mail *is* the work: a sign-up whose verification never arrives, or a "check
 * your inbox" for a reset link that was never sent, leaves someone staring at
 * an empty inbox with nothing to retry and no way to tell that anything went
 * wrong. Better a 500 they can see.
 *
 * The recipient is deliberately absent from the log line. `kind` plus the
 * transport's error is enough to debug a mailer, and the request's own evlog
 * event already carries whatever identity the endpoint established.
 */
async function deliver(kind: string, send: () => Promise<SendEmailResult>): Promise<void> {
  const log = createLogger({ action: "auth_email", kind });
  const result = await send();
  if (result.ok) {
    log.set({ messageId: result.id });
    log.info("auth email sent");
    log.emit();
    return;
  }
  // `sendError` rather than `error`, which `log.error()` takes for the message
  // itself — the transport's reason is the only part of this line worth having.
  log.set({ sendError: result.error });
  log.error("auth email failed");
  log.emit();
  throw new APIError("INTERNAL_SERVER_ERROR", {
    code: "EMAIL_SEND_FAILED",
    message: "Could not send the email. Check the mail configuration and try again.",
  });
}

/**
 * Sign-up verification, and the second half of a change of address: Better
 * Auth reuses this callback for a change requested by an account whose current
 * address was never verified, in which case `user.email` is already the *new*
 * address and this is the only mail sent. Addressing `user.email` rather than
 * anything remembered from the request is what makes both paths correct.
 */
function sendVerification({ url, user }: { url: string; user: { email: string } }): Promise<void> {
  return deliver("verify_email", () => sendVerificationEmail({ to: user.email, url }));
}

/** Password reset — the only way back into a box whose signup has closed. */
function sendResetPassword({ url, user }: { url: string; user: { email: string } }): Promise<void> {
  return deliver("reset_password", () => sendPasswordResetEmail({ to: user.email, url }));
}

/**
 * Approval for a change of address, sent to the address currently on the
 * account rather than to `newEmail`. Better Auth only takes this path when the
 * current address is verified, which is precisely when it is worth asking:
 * whoever reads that inbox owns the account, so only they may hand it on.
 */
function sendChangeEmailConfirmation({
  newEmail,
  url,
  user,
}: {
  newEmail: string;
  url: string;
  user: { email: string };
}): Promise<void> {
  return deliver("change_email", () =>
    sendChangeEmailVerification({ newEmail, to: user.email, url })
  );
}

export function createAuth() {
  const db = createDb();

  /**
   * Whether a mailer is configured, read once so that every switch below
   * agrees with every other one.
   *
   * Email is opt-in and `RESEND_API_KEY` is the switch, so a key-less install
   * has to end up with exactly the auth it had before this epic — not a
   * half-configured one. Three options change *behaviour* rather than merely
   * sending mail, and all three are this boolean: `requireEmailVerification`
   * hardcoded to `true` would lock every account out from behind a mail that
   * can never be sent; `sendOnSignUp` would fail every sign-up on the send
   * error {@link deliver} raises; and `changeEmail.enabled` would offer a flow
   * whose confirmation link never arrives.
   *
   * The callbacks are gated on the same boolean for the same reason. Better
   * Auth decides whether `/request-password-reset` and
   * `/send-verification-email` exist at all by whether their callback is
   * defined, so leaving them wired to a mailer that cannot send would turn
   * today's honest "reset password isn't enabled" into a 500.
   */
  const mailer = emailEnabled();

  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    database: drizzleAdapter(db, {
      provider: "pg",

      schema,
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: mailer,
      sendResetPassword: mailer ? sendResetPassword : undefined,
    },
    emailVerification: {
      // Verifying is the last step of signing up, so finishing it should leave
      // the user signed in rather than back at a login form they just filled.
      autoSignInAfterVerification: true,
      sendOnSignUp: mailer,
      sendVerificationEmail: mailer ? sendVerification : undefined,
    },
    hooks: {
      before: closeSignupAfterFirstUser,
    },
    plugins: [nextCookies()],
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.CORS_ORIGIN],
    user: {
      changeEmail: {
        enabled: mailer,
        sendChangeEmailConfirmation: mailer ? sendChangeEmailConfirmation : undefined,
      },
    },
  });
}

export const auth = createAuth();
