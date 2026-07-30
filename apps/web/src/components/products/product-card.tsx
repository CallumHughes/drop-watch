import type { ProductSummary } from "@price-tracker/api/routers/products";
import { Card, CardContent, CardHeader, CardTitle } from "@price-tracker/ui/components/card";
import Image from "next/image";
import Link from "next/link";

import { formatPrice, formatRelative, formatStock, productHost } from "@/lib/format";

import { Sparkline } from "./sparkline";
import { StatusBadge } from "./status-badge";

const THUMBNAIL_SIZE = 56;

/** Green when the target is met, muted otherwise. Returns null with no target. */
function TargetDistance({
  currency,
  targetDelta,
  targetPrice,
}: {
  currency: string | null;
  targetDelta: string | null;
  targetPrice: string | null;
}) {
  if (!targetPrice) {
    return null;
  }
  const target = `target ${formatPrice(targetPrice, currency)}`;
  if (!targetDelta) {
    return <span className="text-muted-foreground">{target}</span>;
  }
  // The `target` rule fires at price ≤ target, so landing exactly on it counts
  // as met, and reads better as "at target" than as "£0.00 over target".
  const under = targetDelta.startsWith("-");
  const exact = Number(targetDelta) === 0;
  const magnitude = under ? targetDelta.slice(1) : targetDelta;
  return (
    <span
      className={
        under || exact ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
      }
    >
      {exact
        ? `at ${target}`
        : `${formatPrice(magnitude, currency)} ${under ? "under" : "over"} ${target}`}
    </span>
  );
}

function PriceChange({ changePercent }: { changePercent: string | null }) {
  if (!changePercent || changePercent === "0.0") {
    return null;
  }
  const fell = changePercent.startsWith("-");
  return (
    <span className={fell ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>
      {fell ? "▼" : "▲"} {changePercent.replace("-", "")}%
    </span>
  );
}

/**
 * One tracked product at a glance: what it costs now, where that sits against
 * the target, the shape of the recent history, and whether the tracker itself
 * is still working.
 */
export function ProductCard({ summary }: { summary: ProductSummary }) {
  const { history, lastCheck, latest, product } = summary;
  const title = product.title ?? productHost(product.url);

  return (
    <Card className="relative transition-colors hover:ring-foreground/25">
      <CardHeader>
        <div className="flex items-start gap-3">
          {product.imageUrl ? (
            <Image
              alt=""
              className="size-14 shrink-0 bg-white object-contain ring-1 ring-foreground/10"
              height={THUMBNAIL_SIZE}
              src={product.imageUrl}
              unoptimized
              width={THUMBNAIL_SIZE}
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate">
              <Link
                className="after:absolute after:inset-0 hover:underline"
                href={`/products/${product.id}`}
              >
                {title}
              </Link>
            </CardTitle>
            <p className="truncate text-muted-foreground text-xs">{productHost(product.url)}</p>
          </div>
          <StatusBadge
            active={product.active}
            consecutiveFailures={summary.consecutiveFailures}
            lastStatus={lastCheck?.status ?? null}
          />
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <span className="font-medium text-2xl tabular-nums">
            {latest ? formatPrice(latest.price, latest.currency) : "—"}
          </span>
          <PriceChange changePercent={summary.changePercent} />
        </div>

        <div className="flex flex-wrap gap-x-3 text-xs">
          <TargetDistance
            currency={product.currency}
            targetDelta={summary.targetDelta}
            targetPrice={product.targetPrice}
          />
          {latest ? (
            <span className="text-muted-foreground">{formatStock(latest.inStock)}</span>
          ) : null}
        </div>

        <Sparkline samples={history} />

        <div className="flex justify-between text-muted-foreground text-xs">
          <span>
            {lastCheck ? `checked ${formatRelative(lastCheck.startedAt)}` : "never checked"}
          </span>
          <span>next {formatRelative(product.nextCheckAt)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
