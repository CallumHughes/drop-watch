"use client";

import { Button } from "@drop-watch/ui/components/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

/** Product-level delete: two-step confirm, mirroring `ListingRow`'s remove. */
export function DeleteProductButton({ productId }: { productId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const remove = useMutation(
    orpc.products.remove.mutationOptions({
      onError: (error) => {
        toast.error(`Could not delete: ${error.message}`);
      },
      onSuccess: () => {
        toast.success("Product deleted.");
        // Replace, not push: the page behind us describes a product that no
        // longer exists, and back would re-render it from cache before 404ing.
        router.replace("/");
        // Narrower than the usual `orpc.products.key()`: this page's own
        // detail/history/checkRuns/stats queries are still mounted during
        // the navigation away, and invalidating them would 404 a product
        // that no longer exists.
        queryClient.invalidateQueries({ queryKey: orpc.products.list.key() });
      },
    })
  );

  const startDelete = useCallback(() => setConfirmingDelete(true), []);
  const cancelDelete = useCallback(() => setConfirmingDelete(false), []);
  const confirmDelete = useCallback(() => {
    remove.mutate({ id: productId });
  }, [productId, remove]);

  if (confirmingDelete) {
    return (
      <>
        <Button onClick={cancelDelete} size="sm" variant="ghost">
          Cancel
        </Button>
        <Button disabled={remove.isPending} onClick={confirmDelete} size="sm" variant="destructive">
          {remove.isPending ? "Deleting…" : "Confirm delete"}
        </Button>
      </>
    );
  }

  return (
    <Button onClick={startDelete} size="sm" variant="ghost">
      Delete product
    </Button>
  );
}
