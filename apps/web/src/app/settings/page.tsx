import { auth } from "@price-tracker/auth";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SettingsForm } from "@/components/settings/settings-form";

/**
 * The settings row is edited here and read by the worker on its very next
 * check, so a cached render of it would show config that is no longer in force.
 */
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <main className="container mx-auto max-w-2xl overflow-y-auto px-4 py-6">
      <header className="mb-6">
        <h1 className="font-medium text-xl">Settings</h1>
        <p className="text-muted-foreground text-sm">
          Alerts are pushed to a Home Assistant webhook. The webhook id is the secret — pair it with{" "}
          <code className="text-xs">local_only: true</code> in the automation to keep it on the LAN.
        </p>
      </header>

      <SettingsForm />

      <Link
        className="mt-6 inline-block text-muted-foreground text-xs hover:underline"
        href="/dashboard"
      >
        ← Back to dashboard
      </Link>
    </main>
  );
}
