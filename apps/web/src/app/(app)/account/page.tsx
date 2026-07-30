import { auth } from "@price-tracker/auth";
import { emailEnabled } from "@price-tracker/email";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import ChangeEmailForm from "./change-email-form";

/** Reads the session and the mailer's state, neither of which may be cached. */
export const dynamic = "force-dynamic";

/**
 * The account itself: which address it is on, and whether that address has
 * been confirmed.
 *
 * Unlike the other pages added with the mailer, this one is not gated — the
 * facts it states are true either way, and on a key-less install "unverified"
 * is the honest answer rather than a problem to fix. Only the change-email
 * form is hidden, because it is the half that cannot work without a mail.
 *
 * When email is on, `emailVerified` is not cosmetic: it is what
 * `requireEmailVerification` blocks sign-in on, and what decides whose inbox a
 * change of address is approved from. So it is stated plainly, with the way to
 * fix it next to it.
 */
export default async function AccountPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user) {
    redirect("/login");
  }

  const mailer = emailEnabled();
  const { email, emailVerified, name } = session.user;

  return (
    <main className="container mx-auto max-w-2xl overflow-y-auto px-4 py-6">
      <header className="mb-6">
        <h1 className="font-medium text-xl">Account</h1>
        <p className="text-muted-foreground text-sm">
          Signed in as {name}. This is the address the tracker uses to reach you.
        </p>
      </header>

      <section className="mb-8 space-y-2">
        <h2 className="font-medium text-sm">Email</h2>
        <p className="text-sm">{email}</p>
        <p className="text-muted-foreground text-xs">
          {emailVerified ? "Confirmed." : "Not confirmed."}
          {emailVerified || !mailer ? null : (
            <>
              {" "}
              <Link className="hover:underline" href="/verify-email">
                Send a confirmation link →
              </Link>
            </>
          )}
        </p>
      </section>

      {mailer ? (
        <section className="mb-8 space-y-3">
          <h2 className="font-medium text-sm">Change email</h2>
          <ChangeEmailForm currentEmail={email} verified={emailVerified} />
        </section>
      ) : null}
    </main>
  );
}
