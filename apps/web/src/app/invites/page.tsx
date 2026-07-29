import { auth } from "@price-tracker/auth";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { InvitesManager } from "@/components/invites/invites-manager";

/**
 * Never cached: the page is gated on who is asking, and the list it renders
 * changes every time an invite is issued, accepted or revoked.
 */
export const dynamic = "force-dynamic";

export default async function InvitesPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user) {
    redirect("/login");
  }
  // Redirect rather than 403: a signed-in non-admin has a perfectly good home
  // page, and every invites procedure re-checks the role server-side anyway.
  if (session.user.role !== "admin") {
    redirect("/dashboard");
  }

  return (
    <main className="container mx-auto max-w-2xl overflow-y-auto px-4 py-6">
      <header className="mb-6">
        <h1 className="font-medium text-xl">Invites</h1>
        <p className="text-muted-foreground text-sm">
          Signup is invite-only. Send someone a link and they can create an account for the invited
          address — links are single-use and expire after 48 hours.
        </p>
      </header>

      <InvitesManager />

      <Link
        className="mt-6 inline-block text-muted-foreground text-xs hover:underline"
        href="/dashboard"
      >
        ← Back to dashboard
      </Link>
    </main>
  );
}
