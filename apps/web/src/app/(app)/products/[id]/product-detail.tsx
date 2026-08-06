"use client";

import type { Listing, ListingSummary, PriceSample } from "@drop-watch/api/routers/products";
import { Card, CardContent, CardHeader, CardTitle } from "@drop-watch/ui/components/card";
import { Skeleton } from "@drop-watch/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import Image from "next/image";

import { CheckActivityProvider, useCheckActivity } from "@/components/products/check-activity";
import { CheckNowButton } from "@/components/products/check-now-button";
import { CheckRunLog } from "@/components/products/check-run-log";
import { DeleteProductButton } from "@/components/products/delete-product-button";
import { ListingsCard } from "@/components/products/listings-card";
import { PriceHistoryChart } from "@/components/products/price-history-chart";
import { StatusBadge } from "@/components/products/status-badge";
import { WatchSettingsForm } from "@/components/products/watch-settings-form";
import { CHECK_REFETCH_MS, checkRefetchInterval } from "@/lib/check-refetch";
import {
  formatAvailability,
  formatPrice,
  formatRelative,
  LIVE_REFETCH_MS,
  productHost,
} from "@/lib/format";
import { orpc } from "@/utils/orpc";

const THUMBNAIL_SIZE = 72;
const HISTORY_POINTS = 200;
const LOG_ROWS = 50;

function Stat({ hint, label, value }: { hint?: string; label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-sm tabular-nums">{value}</div>
      {hint ? <div className="text-muted-foreground text-xs">{hint}</div> : null}
    </div>
  );
}

const TRAILING_SLASHES = /\/+$/;

/** The last path segment, for telling apart two listings that share a host. */
function pathTail(url: string): string {
  try {
    const path = new URL(url).pathname.replace(TRAILING_SLASHES, "");
    const segment = path.split("/").filter(Boolean).at(-1);
    return segment ? decodeURIComponent(segment) : path;
  } catch {
    return url;
  }
}

/**
 * One chart label per listing: the host, disambiguated with the URL's last
 * path segment when two listings share a hostname.
 */
function listingLabels(listingSummaries: readonly ListingSummary[]): Map<string, string> {
  const hosts = listingSummaries.map((summary) => productHost(summary.listing.url));
  const hostCounts = new Map<string, number>();
  for (const host of hosts) {
    hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1);
  }
  const labels = new Map<string, string>();
  listingSummaries.forEach((summary, index) => {
    const host = hosts[index] ?? productHost(summary.listing.url);
    const label =
      (hostCounts.get(host) ?? 0) > 1 ? `${host} · ${pathTail(summary.listing.url)}` : host;
    labels.set(summary.listing.id, label);
  });
  return labels;
}

/** Groups the flat `PriceSample[]` history back into one series per listing. */
function toSeries(
  listingSummaries: readonly ListingSummary[],
  samples: readonly PriceSample[]
): { label: string; listingId: string; samples: PriceSample[] }[] {
  const labels = listingLabels(listingSummaries);
  const byListing = new Map<string, PriceSample[]>();
  for (const sample of samples) {
    const group = byListing.get(sample.listingId) ?? [];
    group.push(sample);
    byListing.set(sample.listingId, group);
  }
  return listingSummaries.map((summary) => ({
    label: labels.get(summary.listing.id) ?? productHost(summary.listing.url),
    listingId: summary.listing.id,
    samples: byListing.get(summary.listing.id) ?? [],
  }));
}

/** The header's location line: a store count once there is more than one, else the host link. */
function StoreLocation({
  listingCount,
  primaryListing,
}: {
  listingCount: number;
  primaryListing: Listing | undefined;
}) {
  if (listingCount > 1) {
    return <p className="text-muted-foreground text-xs">{listingCount} stores</p>;
  }
  if (!primaryListing) {
    return null;
  }
  return (
    <a
      className="inline-flex items-center gap-1 text-muted-foreground text-xs hover:underline"
      href={primaryListing.url}
      rel="noopener noreferrer"
      target="_blank"
    >
      {productHost(primaryListing.url)}
      <ExternalLink className="size-3" />
    </a>
  );
}

/**
 * One product in full: current state, every store tracking it, the whole
 * recorded history, every check attempt, and the controls to change how it is
 * tracked.
 *
 * The live queries all poll on one interval, and on the *same* interval, so a
 * check lands across the page at once rather than a field at a time. That
 * interval is normally {@link LIVE_REFETCH_MS} and drops to a second while a
 * check this page asked for is outstanding — `@/lib/check-refetch` explains
 * why the press itself cannot just wait for the answer.
 */
function ProductDetailView({ productId }: { productId: string }) {
  const input = { id: productId };
  const { pending } = useCheckActivity();
  // The function form, because this query's own data is what says whether the
  // wait is over — the other two have to read it second-hand from here.
  const detail = useQuery(
    orpc.products.detail.queryOptions({
      input,
      refetchInterval: (query) =>
        checkRefetchInterval(query.state.data?.listings, pending, Date.now()),
    })
  );
  const refetchInterval = checkRefetchInterval(detail.data?.listings, pending, Date.now());
  const awaitingCheck = refetchInterval === CHECK_REFETCH_MS;
  const history = useQuery(
    orpc.products.history.queryOptions({
      input: { ...input, limit: HISTORY_POINTS },
      refetchInterval,
    })
  );
  const runs = useQuery(
    orpc.products.checkRuns.queryOptions({
      input: { ...input, limit: LOG_ROWS },
      refetchInterval,
    })
  );
  // No live polling: a whole-history aggregate is too heavy to re-run every
  // 15s for numbers that move once per check. The exception is the wait
  // itself — otherwise the page would show a new price beside observation
  // counts that had not noticed it — and that window closes on its own.
  const stats = useQuery(
    orpc.products.stats.queryOptions({
      input,
      refetchInterval: awaitingCheck ? CHECK_REFETCH_MS : false,
      staleTime: LIVE_REFETCH_MS,
    })
  );

  if (detail.isPending) {
    return <Skeleton className="h-96 w-full" />;
  }

  if (!detail.data) {
    return <p className="text-muted-foreground text-sm">This product could not be loaded.</p>;
  }

  const { cheapestListingId, lastCheck, latest, listings, nextCheckAt, product } = detail.data;
  const primaryListing = listings[0]?.listing;
  const title = product.title ?? (primaryListing ? productHost(primaryListing.url) : "—");
  const multiStore = listings.length > 1;
  const cheapestListing = listings.find((summary) => summary.listing.id === cheapestListingId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start gap-4">
        {product.imageUrl ? (
          <Image
            alt=""
            className="size-18 shrink-0 bg-white object-contain ring-1 ring-foreground/10"
            height={THUMBNAIL_SIZE}
            src={product.imageUrl}
            unoptimized
            width={THUMBNAIL_SIZE}
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-medium text-xl">{title}</h1>
            <StatusBadge
              active={product.active}
              consecutiveFailures={detail.data.consecutiveFailures}
              lastStatus={lastCheck?.status ?? null}
            />
          </div>
          <StoreLocation listingCount={listings.length} primaryListing={primaryListing} />
        </div>
        <div className="flex items-center gap-2">
          <CheckNowButton
            label={multiStore ? "Check all" : undefined}
            target={{ kind: "product", productId: product.id }}
          />
          <DeleteProductButton productId={product.id} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat
          hint={
            multiStore && cheapestListing
              ? `at ${productHost(cheapestListing.listing.url)}`
              : undefined
          }
          label="Current price"
          value={latest ? formatPrice(latest.price, latest.currency) : "—"}
        />
        <Stat
          label="Stock"
          value={latest ? formatAvailability(latest.availability, latest.inStock) : "—"}
        />
        <Stat
          label="Last checked"
          value={lastCheck ? formatRelative(lastCheck.startedAt) : "never"}
        />
        <Stat label="Next check" value={nextCheckAt ? formatRelative(nextCheckAt) : "never"} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Price history</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {stats.data ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Min" value={formatPrice(stats.data.min, product.currency)} />
              <Stat label="Max" value={formatPrice(stats.data.max, product.currency)} />
              <Stat label="Avg" value={formatPrice(stats.data.avg, product.currency)} />
              <Stat label="Observations" value={String(stats.data.count)} />
            </div>
          ) : null}
          {history.isPending ? (
            <Skeleton className="h-72 w-full" />
          ) : (
            <PriceHistoryChart
              currency={product.currency}
              series={toSeries(listings, history.data ?? [])}
              targetPrice={product.targetPrice}
            />
          )}
        </CardContent>
      </Card>

      <ListingsCard listings={listings} productId={product.id} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Watch settings</CardTitle>
          </CardHeader>
          <CardContent>
            <WatchSettingsForm key={product.updatedAt.toISOString()} product={product} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Check log</CardTitle>
          </CardHeader>
          <CardContent>
            {runs.isPending ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <CheckRunLog runs={runs.data ?? []} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/**
 * The provider has to sit outside the component holding the queries: the
 * check-now buttons that report into it are rendered by that same component,
 * and a component cannot consume a context it provides.
 */
export default function ProductDetail({ productId }: { productId: string }) {
  return (
    <CheckActivityProvider>
      <ProductDetailView productId={productId} />
    </CheckActivityProvider>
  );
}
