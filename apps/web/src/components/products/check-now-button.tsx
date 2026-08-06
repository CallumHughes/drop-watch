"use client";

import type { CheckNowResult } from "@drop-watch/api/routers/products";
import { Button } from "@drop-watch/ui/components/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useCallback } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

import { useCheckActivity } from "./check-activity";

type CheckNowTarget =
  | { kind: "listing"; listingId: string }
  | { kind: "product"; productId: string };

/**
 * Enqueues a check onto the queue the worker consumes — for a whole product
 * (every active listing) or for one listing, depending on `target`.
 *
 * The worker picks it up within a second or so, but the mutation resolves as
 * soon as the job is queued, so the result is not in the response. What is in
 * the response is `queuedAt`, which the surrounding page uses to poll quickly
 * until every listing has reported back — without it the answer waits for the
 * next 15s tick. See `./check-activity`.
 *
 * "Already checking" is a success, not a failure: pg-boss's exclusive policy
 * means one listing can have at most one check queued or running, so a second
 * press while a check is in flight is quietly absorbed.
 */
export function CheckNowButton({
  label,
  size = "default",
  target,
  variant = "outline",
}: {
  /** Overrides the idle-state label, e.g. "Check all" for a multi-listing product. */
  label?: string;
  size?: "default" | "icon-sm" | "sm";
  target: CheckNowTarget;
  variant?: "ghost" | "outline";
}) {
  const queryClient = useQueryClient();
  const { onQueued } = useCheckActivity();

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: orpc.products.key() });
  }, [queryClient]);
  const onError = useCallback((error: { message: string }) => {
    toast.error(`Could not queue a check: ${error.message}`);
  }, []);
  const onSuccess = useCallback(
    (result: CheckNowResult) => {
      if (result.status === "queued") {
        toast.success("Check queued — the worker will pick it up shortly.");
      } else {
        toast.info("Already checking.");
      }
      // This refetch cannot carry the result — the worker has not run yet —
      // but it picks up anything the enqueue itself changed. The wait for the
      // result is what `onQueued` starts.
      onQueued(result.queuedAt);
      invalidate();
    },
    [invalidate, onQueued]
  );

  const checkProduct = useMutation(orpc.products.checkNow.mutationOptions({ onError, onSuccess }));
  const checkListing = useMutation(orpc.listings.checkNow.mutationOptions({ onError, onSuccess }));

  const isPending = target.kind === "product" ? checkProduct.isPending : checkListing.isPending;

  const onClick = useCallback(() => {
    if (target.kind === "product") {
      checkProduct.mutate({ id: target.productId });
    } else {
      checkListing.mutate({ listingId: target.listingId });
    }
  }, [checkListing, checkProduct, target]);

  return (
    <Button
      // The product-level button sits on a page full of per-listing "Check
      // now" buttons; a distinct accessible name says which scope this one is.
      aria-label={target.kind === "product" ? "Check every store now" : undefined}
      disabled={isPending}
      onClick={onClick}
      size={size}
      variant={variant}
    >
      <RefreshCw className={isPending ? "animate-spin" : undefined} />
      {isPending ? "Queueing…" : (label ?? "Check now")}
    </Button>
  );
}
