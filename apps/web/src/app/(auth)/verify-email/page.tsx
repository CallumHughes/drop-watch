import { auth } from "@drop-watch/auth";
import { headers } from "next/headers";
import Link from "next/link";

import { requireEmailEnabled } from "@/lib/email-routes";

import ResendVerificationForm from "./resend-verification-form";

/** The session decides what this page says, so it may never be cached. */
export const dynamic = "force-dynamic";

/**
 * Where signing up lands, and where an unverified account comes to try again.
 *
 * This is not the page the link in the mail opens — that is Better Auth's own
 * `/api/auth/verify-email`, which consumes the token and redirects onward. All
 * this page does is explain the wait and offer another mail, which it has to,
 * because with `requireEmailVerification` on there is nothing else an
 * unverified account can do: it cannot sign in, so it cannot reach any page
 * that would offer to resend.
 */
export default async function VerifyEmailPage() {
  requireEmailEnabled();

  const session = await auth.api.getSession({ headers: await headers() });

  return (
    <main className="container mx-auto max-w-md overflow-y-auto px-4 py-10">
      <header className="mb-6">
        <h1 className="font-medium text-xl">Confirm your email</h1>
        <p className="text-muted-foreground text-sm">
          We sent a link to the address on the account. Opening it confirms the address and signs
          you in; until then, signing in is blocked.
        </p>
      </header>

      <ResendVerificationForm defaultEmail={session?.user.email} />

      <p className="mt-6 text-muted-foreground text-xs">
        Nothing arrived? Check the spam folder, and check that the mailer is allowed to deliver to
        this address — Resend's shared sender only delivers to the address that owns the Resend
        account.
      </p>

      <Link
        className="mt-4 inline-block text-muted-foreground text-xs hover:underline"
        href="/login"
      >
        ← Back to sign in
      </Link>
    </main>
  );
}
