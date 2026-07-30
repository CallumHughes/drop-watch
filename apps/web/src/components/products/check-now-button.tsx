"use client";

import { Button } from "@drop-watch/ui/components/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useCallback } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

/**
 * Enqueues a check onto the queue the worker consumes; the worker picks it up
 * within a second or so and the polling queries show the result on their next
 * tick.
 *
 * "Already checking" is a success, not a failure: pg-boss's exclusive policy
 * means one product can have at most one check queued or running, so a second
 * press while a check is in flight is quietly absorbed.
 */
export function CheckNowButton({ productId }: { productId: string }) {
  const queryClient = useQueryClient();

  const checkNow = useMutation(
    orpc.products.checkNow.mutationOptions({
      onError: (error) => {
        toast.error(`Could not queue a check: ${error.message}`);
      },
      onSuccess: (result) => {
        if (result.status === "queued") {
          toast.success("Check queued — the worker will pick it up shortly.");
        } else {
          toast.info("Already checking this product.");
        }
        queryClient.invalidateQueries({ queryKey: orpc.products.key() });
      },
    })
  );

  const onClick = useCallback(() => {
    checkNow.mutate({ id: productId });
  }, [checkNow, productId]);

  return (
    <Button disabled={checkNow.isPending} onClick={onClick} variant="outline">
      <RefreshCw className={checkNow.isPending ? "animate-spin" : undefined} />
      {checkNow.isPending ? "Queueing…" : "Check now"}
    </Button>
  );
}
