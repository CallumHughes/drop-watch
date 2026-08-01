import type { ProductSummary } from "@drop-watch/api/routers/products";

export interface DashboardSection {
  products: ProductSummary[];
  title: string | null;
}

const SECTION_TITLES = {
  atOrBelowTarget: "At or below target",
  everythingElse: "Everything else",
  needsAttention: "Needs attention",
  recentlyDropped: "Recently dropped",
} as const;

/** `targetDelta` is a decimal string; zero or negative means the target is met. */
function isAtOrBelowTarget(summary: ProductSummary): boolean {
  return summary.targetDelta !== null && Number(summary.targetDelta) <= 0;
}

function isRecentlyDropped(summary: ProductSummary): boolean {
  return summary.changePercent !== null && Number(summary.changePercent) < 0;
}

/**
 * Buckets products into priority-ordered sections, each product appearing
 * once, in the first section it qualifies for. When nothing qualifies for
 * any named section, the result is a single untitled section — the flat
 * grid look.
 */
export function groupIntoSections(summaries: ProductSummary[]): DashboardSection[] {
  const needsAttention = summaries.filter((s) => s.consecutiveFailures > 0);
  const atOrBelowTarget = summaries.filter(
    (s) => !needsAttention.includes(s) && isAtOrBelowTarget(s)
  );
  const recentlyDropped = summaries.filter(
    (s) => !(needsAttention.includes(s) || atOrBelowTarget.includes(s)) && isRecentlyDropped(s)
  );
  const sectioned = new Set([...needsAttention, ...atOrBelowTarget, ...recentlyDropped]);
  const rest = summaries.filter((s) => !sectioned.has(s));

  const hasSections = sectioned.size > 0;
  const sections: DashboardSection[] = [
    { products: needsAttention, title: SECTION_TITLES.needsAttention },
    { products: atOrBelowTarget, title: SECTION_TITLES.atOrBelowTarget },
    { products: recentlyDropped, title: SECTION_TITLES.recentlyDropped },
    { products: rest, title: hasSections ? SECTION_TITLES.everythingElse : null },
  ];

  return sections.filter((section) => section.products.length > 0);
}
