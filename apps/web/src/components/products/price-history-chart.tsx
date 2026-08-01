"use client";

import type { PriceSample } from "@drop-watch/api/routers/products";
import { useCallback } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatAvailability, formatDateTime, formatPrice } from "@/lib/format";

/** Headroom above and below the observed range so the line is not on an edge. */
const AXIS_PADDING_RATIO = 0.05;

/** Axis labels are money, and money in this schema is scale 2. */
const PRICE_TICK_DECIMALS = 2;

const TICK_STYLE = { fill: "var(--muted-foreground)", fontSize: 11 } as const;
const LEGEND_STYLE = { fontSize: 11 } as const;

const TARGET_LABEL = {
  fill: "var(--muted-foreground)",
  fontSize: 11,
  position: "insideBottomRight",
  value: "target",
} as const;

/** Cycled deterministically by series order — five hues before repeating. */
const SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

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

/** One store's line: its own points, plus what to call it and how to colour it. */
interface ChartSeries {
  color: string;
  label: string;
  listingId: string;
  points: ChartPoint[];
}

function toChartPoints(samples: readonly PriceSample[], currency: string | null): ChartPoint[] {
  return samples.map((sample) => ({
    inStock: sample.inStock,
    label: formatPrice(sample.price, sample.currency ?? currency),
    price: Number(sample.price),
    stock: formatAvailability(sample.availability, sample.inStock),
    timestamp: sample.observedAt.getTime(),
  }));
}

/**
 * Recharts hands the tooltip the payload of whichever line is nearest the
 * cursor — with each `<Line>` reading its own `data`, that is one entry, not
 * one per series, so the store name is only worth showing when there is more
 * than one line to disambiguate.
 */
function ChartTooltip({
  active,
  payload,
  showSeriesLabel,
}: {
  active?: boolean;
  payload?: { name?: string; payload: ChartPoint }[];
  showSeriesLabel: boolean;
}) {
  const entry = payload?.[0];
  const point = entry?.payload;
  if (!(active && point)) {
    return null;
  }
  return (
    <div className="bg-popover px-2 py-1.5 text-xs ring-1 ring-foreground/15">
      {showSeriesLabel && entry?.name ? (
        <div className="text-muted-foreground">{entry.name}</div>
      ) : null}
      <div className="font-medium tabular-nums">{point.label}</div>
      <div className="text-muted-foreground">{formatDateTime(new Date(point.timestamp))}</div>
      <div className="text-muted-foreground">{point.stock}</div>
    </div>
  );
}

/**
 * Full price history, one line per listing.
 *
 * Duplicate-looking points a second apart are expected rather than a bug:
 * queue delivery is at-least-once, so a worker killed mid-batch can record the
 * same observation twice. The chart plots what happened and does not
 * second-guess it.
 */
export function PriceHistoryChart({
  currency,
  series,
  targetPrice,
}: {
  currency: string | null;
  series: readonly { label: string; listingId: string; samples: readonly PriceSample[] }[];
  targetPrice: string | null;
}) {
  // Recharts calls this once per tick, so it has to be a stable reference; it
  // closes over `currency`, which rules out hoisting it to module scope.
  const formatPriceTick = useCallback(
    (value: number) => formatPrice(value.toFixed(PRICE_TICK_DECIMALS), currency),
    [currency]
  );

  const chartSeries: ChartSeries[] = series.map((oneSeries, index) => ({
    color: SERIES_COLORS[index % SERIES_COLORS.length] as string,
    label: oneSeries.label,
    listingId: oneSeries.listingId,
    points: toChartPoints(oneSeries.samples, currency),
  }));
  const allPoints = chartSeries.flatMap((oneSeries) => oneSeries.points);

  if (allPoints.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center text-muted-foreground text-sm">
        No price history recorded yet.
      </div>
    );
  }

  const values = allPoints.map((point) => point.price);
  const target = targetPrice ? Number(targetPrice) : null;
  const low = Math.min(...values, target ?? Number.POSITIVE_INFINITY);
  const high = Math.max(...values, target ?? Number.NEGATIVE_INFINITY);
  const padding = Math.max((high - low) * AXIS_PADDING_RATIO, 1);
  const showLegend = chartSeries.length > 1;

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer height="100%" width="100%">
        <LineChart margin={{ bottom: 4, left: 4, right: 12, top: 8 }}>
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
          <Tooltip content={<ChartTooltip showSeriesLabel={showLegend} />} />
          {showLegend ? <Legend wrapperStyle={LEGEND_STYLE} /> : null}
          {target === null ? null : (
            <ReferenceLine
              label={TARGET_LABEL}
              stroke="var(--chart-2)"
              strokeDasharray="4 4"
              y={target}
            />
          )}
          {chartSeries.map((oneSeries) => (
            <Line
              data={oneSeries.points}
              dataKey="price"
              dot={{ r: 2 }}
              isAnimationActive={false}
              key={oneSeries.listingId}
              name={oneSeries.label}
              stroke={oneSeries.color}
              strokeWidth={2}
              type="monotone"
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
