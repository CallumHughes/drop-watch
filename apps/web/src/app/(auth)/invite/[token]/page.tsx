import { invitesRouter } from "@drop-watch/api/routers/invites";
import { auth } from "@drop-watch/auth";
import { call } from "@orpc/server";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import InviteSignUp from "./invite-sign-up";

/**
 * Never cached: the whole page is a function of a single-use token in the
 * path, and a cached render would keep offering a form for a link that has
 * since been accepted, revoked or expired.
 */
export const dynamic = "force-dynamic";

/**
 * Where an invite link lands.
 *
 * The token is validated server-side by calling the `invites.check` procedure
 * in-process (`call` with a sessionless context) — the browser oRPC client is
 * fetch-based and there is nothing to fetch from inside our own server
 * component, and importing `@drop-watch/db` here directly would put the web
 * app on the wrong side of the "UI reads the API" line. A dead token gets a
 * static explanation rather than a form doomed to a 403.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session?.user) {
    redirect("/");
  }

  const { token } = await params;
  const invite = await call(
    invitesRouter.check,
    { token },
    { context: { auth: null, session: null } }
  );

  if (!invite.valid) {
    return (
      <main className="container mx-auto max-w-md overflow-y-auto px-4 py-10">
        <header className="mb-6">
          <h1 className="font-medium text-xl">Invite not valid</h1>
        </header>
        <div className="space-y-4">
          <p className="text-sm">
            This invite link is no longer valid. Ask the admin to send a new one.
          </p>
          <Link
            className="inline-block text-muted-foreground text-xs hover:underline"
            href="/login"
          >
            Go to sign in →
          </Link>
        </div>
      </main>
    );
  }

  return <InviteSignUp email={invite.email} token={token} />;
}
