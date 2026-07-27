import { auth } from "@price-tracker/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import Dashboard from "./dashboard";

/**
 * Never cached. The App Router would happily serve a price from days ago, which
 * is catastrophic in an app whose whole purpose is freshness (PLAN.md §8).
 */
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <main className="container mx-auto max-w-6xl overflow-y-auto px-4 py-6">
      <header className="mb-6">
        <h1 className="font-medium text-xl">Tracked products</h1>
        <p className="text-muted-foreground text-sm">
          Signed in as {session.user.email}. Prices refresh automatically.
        </p>
      </header>
      <Dashboard />
    </main>
  );
}
