import { auth } from "@price-tracker/auth";
import { buttonVariants } from "@price-tracker/ui/components/button";
import { headers } from "next/headers";
import Link from "next/link";
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
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <h1 className="font-medium text-xl">Tracked products</h1>
        <Link className={buttonVariants()} href="/products/new">
          Add product
        </Link>
      </header>
      <Dashboard />
    </main>
  );
}
