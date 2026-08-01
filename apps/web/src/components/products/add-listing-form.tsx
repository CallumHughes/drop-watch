"use client";

import { Button } from "@drop-watch/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@drop-watch/ui/components/card";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

import { PreviewFlow } from "./preview-flow";
import { usePreviewFlow } from "./use-preview-flow";

/**
 * The add-listing flow: same URL-to-preview machinery as `AddProductForm`,
 * ending in `listings.add` instead of `products.create`. No target price
 * here — alert configuration is product-level and unaffected by adding a
 * second store.
 */
export function AddListingForm({
  onSuccess,
  productId,
}: {
  onSuccess?: () => void;
  productId: string;
}) {
  const queryClient = useQueryClient();
  const flow = usePreviewFlow();

  const addListing = useMutation(
    orpc.listings.add.mutationOptions({
      onError: (error) => {
        toast.error(`Could not add store: ${error.message}`);
      },
      onSuccess: () => {
        toast.success("Store added — the first check runs within a minute.");
        queryClient.invalidateQueries({ queryKey: orpc.products.key() });
        onSuccess?.();
      },
    })
  );

  const { chosen, preview, savingWithSelector, trimmedSelector } = flow;
  const onSave = useCallback(() => {
    if (!(preview && chosen)) {
      return;
    }
    addListing.mutate({
      currency: chosen.currency,
      extractor: savingWithSelector ? "selector" : "auto",
      productId,
      selector: savingWithSelector ? trimmedSelector : null,
      url: preview.url,
    });
  }, [addListing, chosen, preview, productId, savingWithSelector, trimmedSelector]);

  let extractorNote = "Find a price above before saving.";
  if (chosen) {
    extractorNote = savingWithSelector
      ? `Will be tracked with the selector ${trimmedSelector}.`
      : "Will be tracked with the automatic extractor chain.";
  }

  return (
    <div className="flex flex-col gap-6">
      <PreviewFlow flow={flow} />
      {preview ? (
        <Card>
          <CardHeader>
            <CardTitle>Save</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-muted-foreground text-xs">{extractorNote}</p>
            <div>
              <Button disabled={!chosen || addListing.isPending} onClick={onSave} type="button">
                {addListing.isPending ? "Saving…" : "Add store"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
