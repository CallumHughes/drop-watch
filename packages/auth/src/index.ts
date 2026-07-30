import { createDb } from "@drop-watch/db";
import { findPendingInvite, markInviteAccepted } from "@drop-watch/db/invites";
// biome-ignore lint/performance/noNamespaceImport: drizzle adapter requires the full schema object.
import * as schema from "@drop-watch/db/schema/auth";
import { signupOpen } from "@drop-watch/db/signup";
import {
  emailEnabled,
  type SendEmailResult,
  sendChangeEmailVerification,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "@drop-watch/email";
import { env } from "@drop-watch/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins/admin";
import { createLogger } from "evlog";

/** The endpoint the guard below closes. */
const SIGN_UP_PATH = "/sign-up/email";

/**
 * The invite token riding in a sign-up body, if a plausible one is there.
 *
 * Better Auth's sign-up schema passes unknown body keys through to hooks (and
 * drops them again before the insert), which is the sanctioned way to smuggle
 * extra context into a signup. The body is untrusted input, so this checks
 * shape rather than assuming it.
 */
function inviteTokenFrom(body: unknown): string | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const token = (body as Record<string, unknown>).inviteToken;
  return typeof token === "string" && token.length > 0 ? token : null;
}

/**
 * Signup is open for exactly one bootstrap account, then invite-only.
 *
 * A fresh install that has not been seeded can still create its first account
 * from the login page — that account becomes the admin (see the database hook
 * below). From then on the only way in is an invite the admin issued: the
 * body must carry a token that resolves to a pending, unexpired invite, *and*
 * the email being registered must be the one the invite was addressed to —
 * an invite is permission for one known inbox, not a transferable ticket.
 *
 * Enforced here rather than only in the UI because hiding a form is not
 * security; the endpoint is what is actually exposed.
 */
const guardSignup = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== SIGN_UP_PATH) {
    return;
  }
  if (await signupOpen()) {
    return;
  }
  const token = inviteTokenFrom(ctx.body);
  if (token) {
    const invite = await findPendingInvite(token);
    const { email } = ctx.body as { email?: unknown };
    if (invite && typeof email === "string" && email.toLowerCase() === invite.email) {
      return;
    }
  }
  throw new APIError("FORBIDDEN", {
    code: "SIGN_UP_DISABLED",
    message: "Signup is invite-only. Ask the admin for an invitation.",
  });
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
function sendVerification({
  url,
  user,
}: {
  url: string;
  user: { email: string; emailVerified: boolean };
}): Promise<void> {
  // The sign-up route sends this unconditionally under `sendOnSignUp`, but an
  // invited account is born verified — nothing to confirm, so send nothing.
  if (user.emailVerified) {
    return Promise.resolve();
  }
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
    appName: "DropWatch",
    baseURL: env.BETTER_AUTH_URL,
    database: drizzleAdapter(db, {
      provider: "pg",

      schema,
    }),
    databaseHooks: {
      user: {
        create: {
          /**
           * Burn the invite only once the user row actually exists — a signup
           * that dies halfway must leave the link usable for another attempt.
           */
          after: async (_created, ctx) => {
            if (ctx?.path !== SIGN_UP_PATH) {
              return;
            }
            const token = inviteTokenFrom(ctx.body);
            if (token) {
              await markInviteAccepted(token);
            }
          },
          /**
           * What kind of user a signup produces. The bootstrap account — the
           * one created while the user table is still empty — is the admin;
           * the admin plugin's own before-hook runs first (plugin database
           * hooks precede config ones), so this `role` override wins over its
           * default. An invited account instead arrives already verified: a
           * valid token proves the admin addressed that inbox, which is the
           * user's accepted standard of proof, and its role falls through to
           * the plugin's default "user".
           */
          before: async (userData, ctx) => {
            if (ctx?.path !== SIGN_UP_PATH) {
              return;
            }
            if (await signupOpen()) {
              return { data: { ...userData, role: "admin" } };
            }
            const token = inviteTokenFrom(ctx.body);
            if (token && (await findPendingInvite(token))) {
              return { data: { ...userData, emailVerified: true } };
            }
          },
        },
      },
    },
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
      before: guardSignup,
    },
    plugins: [admin(), nextCookies()],
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
