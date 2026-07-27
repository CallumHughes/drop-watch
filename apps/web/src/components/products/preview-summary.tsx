import type { PreviewExtraction } from "@price-tracker/api/routers/preview";
import Image from "next/image";

import { formatPrice, formatStock, productHost } from "@/lib/format";

const THUMBNAIL_SIZE = 64;

/** Plain-English names for the chain, so the badge means something to a human. */
const STRATEGY_LABELS: Record<PreviewExtraction["strategy"], string> = {
  jsonld: "schema.org JSON-LD",
  microdata: "microdata",
  opengraph: "OpenGraph tags",
  selector: "CSS selector",
};

/**
 * What the extraction chain made of a page, and — the part that matters when
 * something later looks wrong — which link in the chain produced it.
 */
export function PreviewSummary({
  extraction,
  url,
}: {
  extraction: PreviewExtraction;
  url: string;
}) {
  return (
    <div className="flex items-start gap-4">
      {extraction.imageUrl ? (
        <Image
          alt=""
          className="size-16 shrink-0 bg-white object-contain ring-1 ring-foreground/10"
          height={THUMBNAIL_SIZE}
          src={extraction.imageUrl}
          unoptimized
          width={THUMBNAIL_SIZE}
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{extraction.title ?? productHost(url)}</p>
        <p className="flex flex-wrap items-baseline gap-x-3">
          <span className="font-medium text-2xl tabular-nums">
            {formatPrice(extraction.price, extraction.currency)}
          </span>
          <span className="text-muted-foreground text-xs">
            {extraction.currency ?? "currency unknown"}
          </span>
          <span className="text-muted-foreground text-xs">{formatStock(extraction.inStock)}</span>
        </p>
        <p className="mt-1 text-muted-foreground text-xs">
          found by <span className="text-foreground">{STRATEGY_LABELS[extraction.strategy]}</span>
          {extraction.availability ? ` · availability: ${extraction.availability}` : null}
        </p>
      </div>
    </div>
  );
}
