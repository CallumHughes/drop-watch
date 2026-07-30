import type { PriceSample } from "@drop-watch/api/routers/products";

/** Drawn in an abstract 100×32 box and stretched to whatever the card gives it. */
const VIEW_WIDTH = 100;
const VIEW_HEIGHT = 32;
/** Keeps the stroke from being clipped at the extremes. */
const PADDING = 2;

/**
 * Prices only become numbers here, and only to turn them into coordinates —
 * the values shown as text elsewhere on the card are still the exact decimal
 * strings from the database.
 */
function toPoints(samples: readonly PriceSample[]): string {
  const values = samples.map((sample) => Number(sample.price));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const usableHeight = VIEW_HEIGHT - PADDING * 2;
  const step = values.length > 1 ? VIEW_WIDTH / (values.length - 1) : 0;

  return values
    .map((value, index) => {
      // A flat history has no range to scale against; draw it down the middle.
      const ratio = span === 0 ? 0.5 : (value - min) / span;
      const y = VIEW_HEIGHT - PADDING - ratio * usableHeight;
      const x = values.length > 1 ? index * step : VIEW_WIDTH / 2;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

/**
 * The shape of a product's recent price, at card size. Deliberately not
 * Recharts: no axes, no tooltip, no runtime cost on a list of these.
 */
export function Sparkline({ samples }: { samples: readonly PriceSample[] }) {
  if (samples.length === 0) {
    return (
      <div className="flex h-8 items-center text-muted-foreground text-xs">No history yet</div>
    );
  }

  const points = toPoints(samples);
  return (
    <svg
      aria-label={`Price trend over the last ${samples.length} checks`}
      className="h-8 w-full text-chart-3"
      preserveAspectRatio="none"
      role="img"
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
    >
      {samples.length === 1 ? (
        <circle cx={VIEW_WIDTH / 2} cy={VIEW_HEIGHT / 2} fill="currentColor" r="2" />
      ) : (
        <polyline
          fill="none"
          points={points}
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}
