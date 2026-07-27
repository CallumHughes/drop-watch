"use client";

import type { PriceSample } from "@price-tracker/api/routers/products";
import { useCallback } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatDateTime, formatPrice, formatStock } from "@/lib/format";

/** Headroom above and below the observed range so the line is not on an edge. */
const AXIS_PADDING_RATIO = 0.05;

/** Axis labels are money, and money in this schema is scale 2. */
const PRICE_TICK_DECIMALS = 2;

const TICK_STYLE = { fill: "var(--muted-foreground)", fontSize: 11 } as const;

const TARGET_LABEL = {
  fill: "var(--muted-foreground)",
  fontSize: 11,
  position: "insideBottomRight",
  value: "target",
} as const;

function formatTimeTick(value: number): string {
  return formatDateTime(new Date(value));
}

interface ChartPoint {
  inStock: boolean | null;
  label: string;
  /** Plotted value. Geometry only — `label` is what the reader actually sees. */
  price: number;
  stock: string;
  timestamp: number;
}

function toChartPoints(samples: readonly PriceSample[], currency: string | null): ChartPoint[] {
  return samples.map((sample) => ({
    inStock: sample.inStock,
    label: formatPrice(sample.price, sample.currency ?? currency),
    price: Number(sample.price),
    stock: formatStock(sample.inStock),
    timestamp: sample.observedAt.getTime(),
  }));
}

/** Recharts hands the tooltip its slice of the data array back. */
function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: ChartPoint }[];
}) {
  const point = payload?.[0]?.payload;
  if (!(active && point)) {
    return null;
  }
  return (
    <div className="bg-popover px-2 py-1.5 text-xs ring-1 ring-foreground/15">
      <div className="font-medium tabular-nums">{point.label}</div>
      <div className="text-muted-foreground">{formatDateTime(new Date(point.timestamp))}</div>
      <div className="text-muted-foreground">{point.stock}</div>
    </div>
  );
}

/**
 * Full price history.
 *
 * Duplicate-looking points a second apart are expected rather than a bug:
 * queue delivery is at-least-once, so a worker killed mid-batch can record the
 * same observation twice. The chart plots what happened and does not
 * second-guess it.
 */
export function PriceHistoryChart({
  currency,
  samples,
  targetPrice,
}: {
  currency: string | null;
  samples: readonly PriceSample[];
  targetPrice: string | null;
}) {
  // Recharts calls this once per tick, so it has to be a stable reference; it
  // closes over `currency`, which rules out hoisting it to module scope.
  const formatPriceTick = useCallback(
    (value: number) => formatPrice(value.toFixed(PRICE_TICK_DECIMALS), currency),
    [currency]
  );

  if (samples.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center text-muted-foreground text-sm">
        No price history recorded yet.
      </div>
    );
  }

  const points = toChartPoints(samples, currency);
  const values = points.map((point) => point.price);
  const target = targetPrice ? Number(targetPrice) : null;
  const low = Math.min(...values, target ?? Number.POSITIVE_INFINITY);
  const high = Math.max(...values, target ?? Number.NEGATIVE_INFINITY);
  const padding = Math.max((high - low) * AXIS_PADDING_RATIO, 1);

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer height="100%" width="100%">
        <LineChart data={points} margin={{ bottom: 4, left: 4, right: 12, top: 8 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="timestamp"
            domain={["dataMin", "dataMax"]}
            minTickGap={40}
            scale="time"
            stroke="var(--border)"
            tick={TICK_STYLE}
            tickFormatter={formatTimeTick}
            type="number"
          />
          <YAxis
            domain={[low - padding, high + padding]}
            stroke="var(--border)"
            tick={TICK_STYLE}
            tickFormatter={formatPriceTick}
            width={72}
          />
          <Tooltip content={<ChartTooltip />} />
          {target === null ? null : (
            <ReferenceLine
              label={TARGET_LABEL}
              stroke="var(--chart-2)"
              strokeDasharray="4 4"
              y={target}
            />
          )}
          <Line
            dataKey="price"
            dot={{ r: 2 }}
            isAnimationActive={false}
            stroke="var(--chart-3)"
            strokeWidth={2}
            type="monotone"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
