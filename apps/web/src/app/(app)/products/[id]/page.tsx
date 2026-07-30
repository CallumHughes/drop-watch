import { auth } from "@drop-watch/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import ProductDetail from "./product-detail";

/** Prices must never come from the App Router's cache. */
export const dynamic = "force-dynamic";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user) {
    redirect("/login");
  }

  const { id } = await params;

  return (
    <main className="container mx-auto max-w-5xl overflow-y-auto px-4 py-6">
      <ProductDetail productId={id} />
    </main>
  );
}
