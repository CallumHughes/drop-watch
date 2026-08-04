"use client";

import type { PreviewExtraction } from "@drop-watch/api/routers/preview";
import { PRICE_PATTERN_SOURCE } from "@drop-watch/api/schemas/products";
import { Button } from "@drop-watch/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@drop-watch/ui/components/card";
import { Input } from "@drop-watch/ui/components/input";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { ChangeEvent } from "react";
import { useCallback, useId, useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

import { Field, PreviewFlow } from "./preview-flow";
import { usePreviewFlow } from "./use-preview-flow";

/** The confirm step: an optional target, and what is about to be written. */
function SavePanel({
  chosen,
  extractorNote,
  isSaving,
  onSave,
  onTargetChange,
  targetPrice,
}: {
  chosen: PreviewExtraction | null;
  extractorNote: string;
  isSaving: boolean;
  onSave: () => void;
  onTargetChange: (event: ChangeEvent<HTMLInputElement>) => void;
  targetPrice: string;
}) {
  const targetId = useId();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Save</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field
          hint="Optional. Alert rules are set up on the product page once it exists."
          htmlFor={targetId}
          label={`Target price (${chosen?.currency ?? "currency unknown"})`}
        >
          <Input
            id={targetId}
            inputMode="decimal"
            onChange={onTargetChange}
            pattern={PRICE_PATTERN_SOURCE}
            placeholder="none"
            value={targetPrice}
          />
        </Field>

        <p className="text-muted-foreground text-xs">{extractorNote}</p>

        <div>
          <Button disabled={!chosen || isSaving} onClick={onSave} type="button">
            {isSaving ? "Saving…" : "Track this product"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The add-product flow, end to end: paste a URL, see what the extraction chain
 * makes of it, fall back to a hand-written CSS selector when it makes nothing,
 * then save.
 *
 * Saving pins `nextCheckAt` to now, so the product's first real check lands
 * within a minute rather than after a full interval. The preview machinery
 * itself — fetch, selector test, what got chosen — lives in
 * {@link usePreviewFlow} and {@link PreviewFlow}, shared with `AddListingForm`.
 */
export function AddProductForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const flow = usePreviewFlow();
  const [targetPrice, setTargetPrice] = useState("");

  const create = useMutation(
    orpc.products.create.mutationOptions({
      onError: (error) => {
        toast.error(`Could not save: ${error.message}`);
      },
      onSuccess: (summary) => {
        toast.success("Tracking started — the first check runs within a minute.");
        queryClient.invalidateQueries({ queryKey: orpc.products.key() });
        router.push(`/products/${summary.product.id}`);
      },
    })
  );

  const onTargetChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setTargetPrice(event.target.value);
  }, []);

  const { chosen, preview, savingWithSelector, trimmedSelector } = flow;
  const onSave = useCallback(() => {
    if (!(preview && chosen)) {
      return;
    }
    create.mutate({
      currency: chosen.currency,
      extractor: savingWithSelector ? "selector" : "auto",
      imageUrl: chosen.imageUrl,
      selector: savingWithSelector ? trimmedSelector : null,
      targetPrice: targetPrice.trim() === "" ? null : targetPrice.trim(),
      title: chosen.title,
      url: preview.url,
    });
  }, [chosen, create, preview, savingWithSelector, targetPrice, trimmedSelector]);

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
        <SavePanel
          chosen={chosen}
          extractorNote={extractorNote}
          isSaving={create.isPending}
          onSave={onSave}
          onTargetChange={onTargetChange}
          targetPrice={targetPrice}
        />
      ) : null}
    </div>
  );
}
