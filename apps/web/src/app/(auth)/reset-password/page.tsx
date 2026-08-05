import Link from "next/link";

import { requireEmailEnabled } from "@/lib/email-routes";

import ResetPasswordForm from "./reset-password-form";

/**
 * Never cached: the whole page is a function of a single-use token in the
 * query string, and a cached render of it would be a form wired to somebody
 * else's token.
 */
export const dynamic = "force-dynamic";

/**
 * Where the reset link lands.
 *
 * Better Auth checks the token before redirecting here, so arriving with a
 * `token` means it was valid a moment ago and arriving with an `error` means
 * it was not. Both are handled server-side rather than by the form, because a
 * missing token is not a form the user can fix by filling it in — it is a page
 * that should offer them a fresh link instead.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; token?: string }>;
}) {
  await requireEmailEnabled();

  const { token } = await searchParams;

  return (
    <main className="container mx-auto max-w-md overflow-y-auto px-4 py-10">
      <header className="mb-6">
        <h1 className="font-medium text-xl">Set a new password</h1>
        {token ? (
          <p className="text-muted-foreground text-sm">
            Pick something at least 8 characters long. You will be signed out of nothing else — this
            only changes the password.
          </p>
        ) : null}
      </header>

      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <div className="space-y-4">
          <p className="text-sm">
            This reset link is no longer valid. Links are single-use and expire an hour after they
            are sent.
          </p>
          <Link
            className="inline-block text-muted-foreground text-xs hover:underline"
            href="/forgot-password"
          >
            Send a new one →
          </Link>
        </div>
      )}
    </main>
  );
}
