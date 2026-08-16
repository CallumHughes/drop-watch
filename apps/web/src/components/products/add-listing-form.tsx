"use client";

import { Button } from "@drop-watch/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@drop-watch/ui/components/card";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

import { extractorNote } from "./extractor-note";
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

  const { chosen, mode, preview, savingWithExpression, transportReload, trimmedExpression } = flow;
  const isTransportReloadPending = transportReload?.isPending ?? false;
  const savedMode = savingWithExpression ? mode : null;
  const onSave = useCallback(() => {
    if (!(preview && chosen) || isTransportReloadPending) {
      return;
    }
    addListing.mutate({
      currency: chosen.currency,
      expression: savedMode ? trimmedExpression : null,
      extractor: savedMode ?? "auto",
      productId,
      render: preview.render,
      url: preview.url,
    });
  }, [
    addListing,
    chosen,
    isTransportReloadPending,
    preview,
    productId,
    savedMode,
    trimmedExpression,
  ]);

  const note = extractorNote({
    expression: savedMode ? trimmedExpression : null,
    hasPrice: chosen !== null,
    mode: savedMode,
    render: preview?.render ?? "http",
  });

  return (
    <div className="flex flex-col gap-6">
      <PreviewFlow flow={flow} />
      {preview ? (
        <Card>
          <CardHeader>
            <CardTitle>Save</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-muted-foreground text-xs">{note}</p>
            <div>
              <Button
                disabled={!chosen || addListing.isPending || isTransportReloadPending}
                onClick={onSave}
                type="button"
              >
                {addListing.isPending ? "Saving…" : "Add store"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
