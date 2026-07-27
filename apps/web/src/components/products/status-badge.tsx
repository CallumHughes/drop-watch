import type { CheckStatus } from "@price-tracker/api/routers/products";
import { cn } from "@price-tracker/ui/lib/utils";

/** Human wording for the `check_run_status` enum. */
const STATUS_LABELS: Record<CheckStatus, string> = {
  extract_failed: "no price found",
  http_error: "HTTP error",
  network_error: "network error",
  ok: "ok",
  timeout: "timed out",
};

export function checkStatusLabel(status: CheckStatus): string {
  return STATUS_LABELS[status];
}

function Badge({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 font-medium text-[11px] uppercase tracking-wide ring-1",
        className
      )}
    >
      {children}
    </span>
  );
}

/**
 * The card's health indicator.
 *
 * Only a run of failures earns the red badge — a single blip is normal for a
 * scraper, and a 304 is recorded as `ok`, so an unchanged page never shows up
 * here.
 */
export function StatusBadge({
  active,
  consecutiveFailures,
  lastStatus,
}: {
  active: boolean;
  consecutiveFailures: number;
  lastStatus: CheckStatus | null;
}) {
  if (!active) {
    return <Badge className="text-muted-foreground ring-border">Paused</Badge>;
  }
  if (consecutiveFailures === 0) {
    return null;
  }
  const detail = lastStatus ? checkStatusLabel(lastStatus) : "unknown";
  return (
    <Badge className="bg-destructive/10 text-destructive ring-destructive/30">
      {consecutiveFailures} failed · {detail}
    </Badge>
  );
}
