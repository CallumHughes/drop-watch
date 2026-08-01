"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@drop-watch/ui/components/card";
import { Skeleton } from "@drop-watch/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import Image from "next/image";

import { CheckNowButton } from "@/components/products/check-now-button";
import { CheckRunLog } from "@/components/products/check-run-log";
import { PriceHistoryChart } from "@/components/products/price-history-chart";
import { StatusBadge } from "@/components/products/status-badge";
import { WatchSettingsForm } from "@/components/products/watch-settings-form";
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-sm tabular-nums">{value}</div>
    </div>
  );
}

/**
 * One product in full: current state, the whole recorded history, every check
 * attempt, and the two controls — force a check, change how it is tracked.
 *
 * All three queries poll on the same interval, so pressing "check now" shows
 * up here within a tick without any invalidation gymnastics.
 */
export default function ProductDetail({ productId }: { productId: string }) {
  const input = { id: productId };
  const detail = useQuery(
    orpc.products.detail.queryOptions({ input, refetchInterval: LIVE_REFETCH_MS })
  );
  const history = useQuery(
    orpc.products.history.queryOptions({
      input: { ...input, limit: HISTORY_POINTS },
      refetchInterval: LIVE_REFETCH_MS,
    })
  );
  const runs = useQuery(
    orpc.products.checkRuns.queryOptions({
      input: { ...input, limit: LOG_ROWS },
      refetchInterval: LIVE_REFETCH_MS,
    })
  );
  const stats = useQuery(
    orpc.products.stats.queryOptions({ input, refetchInterval: LIVE_REFETCH_MS })
  );

  if (detail.isPending) {
    return <Skeleton className="h-96 w-full" />;
  }

  if (!detail.data) {
    return <p className="text-muted-foreground text-sm">This product could not be loaded.</p>;
  }

  const { lastCheck, latest, product } = detail.data;
  const title = product.title ?? productHost(product.url);

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
          <a
            className="inline-flex items-center gap-1 text-muted-foreground text-xs hover:underline"
            href={product.url}
            rel="noopener noreferrer"
            target="_blank"
          >
            {productHost(product.url)}
            <ExternalLink className="size-3" />
          </a>
        </div>
        <CheckNowButton productId={product.id} />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat
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
        <Stat label="Next check" value={formatRelative(product.nextCheckAt)} />
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
              samples={history.data ?? []}
              targetPrice={product.targetPrice}
            />
          )}
        </CardContent>
      </Card>

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
