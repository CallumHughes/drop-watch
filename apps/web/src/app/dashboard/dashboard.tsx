"use client";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@price-tracker/ui/components/empty";
import { Skeleton } from "@price-tracker/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";

import { ProductCard } from "@/components/products/product-card";
import { LIVE_REFETCH_MS } from "@/lib/format";
import { orpc } from "@/utils/orpc";

const SKELETON_CARDS = ["a", "b", "c"] as const;

/**
 * The product grid, polled every {@link LIVE_REFETCH_MS}. Polling rather than
 * SSE is a deliberate first cut (PLAN.md §8); the worker writes on its own
 * schedule, so a fixed interval keeps the dashboard within a check of the
 * truth without any push plumbing.
 */
export default function Dashboard() {
  const products = useQuery(orpc.products.list.queryOptions({ refetchInterval: LIVE_REFETCH_MS }));

  if (products.isPending) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {SKELETON_CARDS.map((key) => (
          <Skeleton className="h-52 w-full" key={key} />
        ))}
      </div>
    );
  }

  if (!products.data || products.data.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Nothing tracked yet</EmptyTitle>
          <EmptyDescription>
            Seed the database or add a product to start recording price history.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {products.data.map((summary) => (
        <ProductCard key={summary.product.id} summary={summary} />
      ))}
    </div>
  );
}
