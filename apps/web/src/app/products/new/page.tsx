import { auth } from "@price-tracker/auth";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AddProductForm } from "@/components/products/add-product-form";

/**
 * The preview fetches a live page, so nothing about this route may be cached —
 * same rule as every other price-reading view (PLAN.md §8).
 */
export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <main className="container mx-auto max-w-3xl overflow-y-auto px-4 py-6">
      <header className="mb-6">
        <h1 className="font-medium text-xl">Track a new product</h1>
        <p className="text-muted-foreground text-sm">
          Paste a product URL. Most shops publish structured data and need no further setup; the
          rest need a CSS selector for the price.
        </p>
      </header>

      <AddProductForm />

      <Link
        className="mt-6 inline-block text-muted-foreground text-xs hover:underline"
        href="/dashboard"
      >
        ← Back to dashboard
      </Link>
    </main>
  );
}
