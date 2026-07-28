/**
 * Marks an account's email address as verified, by hand.
 *
 * This is the lockout escape hatch, and it is not optional. Signup closes for
 * good once the first account exists, and with a mailer configured
 * `requireEmailVerification` blocks sign-in until the address is confirmed —
 * so an account created while the mail was misconfigured, or whose
 * verification link expired before anyone opened it, is a locked box with no
 * self-service way in. Nobody can sign up to replace it, and password reset
 * needs the very mailer that is not working.
 *
 * Run with `pnpm db:verify-user <email>`. The equivalent SQL, for a box where
 * only psql is available:
 *
 * ```sql
 * update "user" set email_verified = true where email = 'you@example.com';
 * ```
 *
 * Idempotent: verifying an already-verified account is a no-op that says so.
 */

import { eq } from "drizzle-orm";

import { createDb } from "./index";
import { user } from "./schema/auth";

/** Argument 0 is node, 1 is this script; the email is the first real one. */
const EMAIL_ARG_INDEX = 2;

async function main(): Promise<string> {
  const email = process.argv[EMAIL_ARG_INDEX]?.trim().toLowerCase();
  if (!email) {
    throw new Error("usage: pnpm db:verify-user <email>");
  }

  const db = createDb();
  try {
    // Addresses are stored lowercased by Better Auth, so an exact match is
    // enough and avoids a case-insensitive scan doing something surprising to
    // a second account that differs only in case.
    const [updated] = await db
      .update(user)
      .set({ emailVerified: true, updatedAt: new Date() })
      .where(eq(user.email, email))
      .returning({ id: user.id, verified: user.emailVerified });

    if (!updated) {
      throw new Error(`no account with email ${email}`);
    }
    return `${email} verified (${updated.id})`;
  } finally {
    await db.$client.end();
  }
}

main()
  .then((message) => {
    process.stdout.write(`${message}\n`);
  })
  .catch((error: unknown) => {
    process.stderr.write(
      `verify-user failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
