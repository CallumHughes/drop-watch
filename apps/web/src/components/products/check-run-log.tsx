import type { CheckRun } from "@drop-watch/api/routers/products";

import { formatDateTime, formatDuration } from "@/lib/format";

import { checkStatusLabel } from "./status-badge";

/** A 304 is a healthy check that produced no price point — say so plainly. */
const NOT_MODIFIED = 304;

function statusClass(run: CheckRun): string {
  return run.status === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-destructive";
}

function detailFor(run: CheckRun): string {
  if (run.error) {
    return run.error;
  }
  if (run.httpStatus === NOT_MODIFIED) {
    return "not modified since last check";
  }
  return run.extractorUsed ?? "—";
}

/**
 * Every attempt, successes included. This table is the reason `check_runs`
 * exists: it is what makes "why did this silently stop working" answerable.
 */
export function CheckRunLog({ runs }: { runs: readonly CheckRun[] }) {
  if (runs.length === 0) {
    return <p className="text-muted-foreground text-sm">No checks recorded yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-muted-foreground">
          <tr className="border-foreground/10 border-b">
            <th className="py-1.5 pr-3 font-medium">Started</th>
            <th className="py-1.5 pr-3 font-medium">Result</th>
            <th className="py-1.5 pr-3 font-medium">HTTP</th>
            <th className="py-1.5 pr-3 font-medium">Took</th>
            <th className="py-1.5 font-medium">Detail</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr className="border-foreground/5 border-b last:border-0" key={run.id}>
              <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums">
                {formatDateTime(run.startedAt)}
              </td>
              <td className={`whitespace-nowrap py-1.5 pr-3 ${statusClass(run)}`}>
                {checkStatusLabel(run.status)}
              </td>
              <td className="py-1.5 pr-3 tabular-nums">{run.httpStatus ?? "—"}</td>
              <td className="py-1.5 pr-3 tabular-nums">{formatDuration(run.durationMs)}</td>
              <td className="py-1.5 text-muted-foreground">{detailFor(run)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
