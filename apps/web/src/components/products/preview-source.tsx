"use client";

import { Button } from "@price-tracker/ui/components/button";
import { Skeleton } from "@price-tracker/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { orpc } from "@/utils/orpc";

/**
 * The fetched markup, on demand.
 *
 * Reading the page source is how you find the class name to type into the
 * picker, which is why PLAN.md §8 asks for it. It is loaded lazily and never
 * re-fetched: this is the same cached body the selector runs against, so
 * opening the panel costs one read of memory the server already holds.
 */
export function PreviewSource({ previewId }: { previewId: string }) {
  const [open, setOpen] = useState(false);
  const source = useQuery(
    orpc.preview.source.queryOptions({
      enabled: open,
      input: { previewId },
      // The cached body cannot change while the preview lives.
      staleTime: Number.POSITIVE_INFINITY,
    })
  );

  const toggle = useCallback(() => setOpen((current) => !current), []);

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button onClick={toggle} size="sm" type="button" variant="outline">
          {open ? "Hide page source" : "View page source"}
        </Button>
      </div>
      {open && source.isPending ? <Skeleton className="h-64 w-full" /> : null}
      {open && source.data ? (
        <div className="flex flex-col gap-1">
          <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs leading-relaxed">
            <code>{source.data.html}</code>
          </pre>
          <p className="text-muted-foreground text-xs">
            {source.data.truncated
              ? `Showing the first ${source.data.html.length.toLocaleString()} of ${source.data.totalBytes.toLocaleString()} characters. Selectors still run against the whole document.`
              : `${source.data.totalBytes.toLocaleString()} characters.`}
          </p>
        </div>
      ) : null}
    </div>
  );
}
