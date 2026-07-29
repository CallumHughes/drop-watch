"use client";

import type {
  PagePreview,
  PreviewExtraction,
  SelectorPreview,
} from "@price-tracker/api/routers/preview";
import { PRICE_PATTERN_SOURCE } from "@price-tracker/api/schemas/products";
import { Button } from "@price-tracker/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@price-tracker/ui/components/card";
import { Input } from "@price-tracker/ui/components/input";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { ChangeEvent, FormEvent } from "react";
import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { productHost } from "@/lib/format";
import { orpc } from "@/utils/orpc";

import { PreviewSummary } from "./preview-summary";
import { SelectorPicker } from "./selector-picker";

/**
 * Long enough that a typed selector settles before it is tried, short enough to
 * feel live. It only spaces out server round trips — no fetch happens either
 * way, because the page is already in memory.
 */
const SELECTOR_DEBOUNCE_MS = 300;

function Field({
  children,
  htmlFor,
  hint,
  label,
}: {
  children: React.ReactNode;
  hint?: string;
  htmlFor: string;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-muted-foreground text-xs" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

/** What the chain found, plus the manual override when one is being worked on. */
function PreviewPanel({
  isTesting,
  onSelectorChange,
  onTogglePicker,
  preview,
  selector,
  test,
  usingSelector,
}: {
  isTesting: boolean;
  onSelectorChange: (selector: string) => void;
  onTogglePicker: () => void;
  preview: PagePreview;
  selector: string;
  test: SelectorPreview | undefined;
  usingSelector: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Preview</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-muted-foreground text-xs">
          {productHost(preview.url)} · HTTP {preview.httpStatus} ·{" "}
          {preview.htmlBytes.toLocaleString()} bytes cached
        </p>

        {preview.extraction ? (
          <>
            <PreviewSummary extraction={preview.extraction} url={preview.url} />
            <div>
              <Button onClick={onTogglePicker} size="sm" type="button" variant="outline">
                {usingSelector ? "Use the automatic result" : "Pick the price myself"}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm">
            Nothing matched automatically: {preview.extractionError}. Pick the price element
            yourself below.
          </p>
        )}

        {usingSelector ? (
          <SelectorPicker
            isPending={isTesting}
            onSelectorChange={onSelectorChange}
            previewId={preview.previewId}
            selector={selector}
            test={test}
            url={preview.url}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

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
 * The URL is fetched exactly once, at step two. Everything after that — every
 * selector edit, the page source panel — reads the server's cached copy of that
 * response (PLAN.md §8). Saving pins `nextCheckAt` to now, so the product's
 * first real check lands within a minute rather than after a full interval.
 */
export function AddProductForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const urlId = useId();

  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<PagePreview | null>(null);
  const [usingSelector, setUsingSelector] = useState(false);
  const [selector, setSelector] = useState("");
  const [settledSelector, setSettledSelector] = useState("");
  const [targetPrice, setTargetPrice] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setSettledSelector(selector), SELECTOR_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [selector]);

  const fetchPreview = useMutation(
    orpc.preview.page.mutationOptions({
      onError: (error) => {
        toast.error(error.message);
      },
      onSuccess: (data) => {
        setPreview(data);
        setSelector("");
        setSettledSelector("");
        // Nothing matched automatically, so the selector picker is the next
        // step rather than an option buried behind a toggle.
        setUsingSelector(data.extraction === null);
      },
    })
  );

  const previewId = preview?.previewId ?? "";
  const trimmedSelector = settledSelector.trim();
  const selectorTest = useQuery(
    orpc.preview.testSelector.queryOptions({
      enabled: usingSelector && previewId !== "" && trimmedSelector.length > 0,
      input: { previewId, selector: trimmedSelector },
      // The cached body cannot change, so a selector already tried never needs
      // asking twice — and none of this ever touches the network.
      staleTime: Number.POSITIVE_INFINITY,
    })
  );

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

  const onUrlChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setUrl(event.target.value);
  }, []);
  const onTargetChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setTargetPrice(event.target.value);
  }, []);
  const togglePicker = useCallback(() => {
    setUsingSelector((current) => !current);
  }, []);

  const onFetch = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setPreview(null);
      fetchPreview.mutate({ url: url.trim() });
    },
    [fetchPreview, url]
  );

  // Whichever half of the flow produced a price is what gets saved. The picker
  // wins when it is open and working, so a page whose JSON-LD quotes the wrong
  // price can still be corrected by hand.
  const selectorExtraction = usingSelector ? (selectorTest.data?.extraction ?? null) : null;
  const chosen: PreviewExtraction | null = selectorExtraction ?? preview?.extraction ?? null;
  const savingWithSelector = selectorExtraction !== null;

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
      <form className="flex flex-col gap-2" onSubmit={onFetch}>
        <Field
          hint="The page is fetched once. Everything after that runs against that copy."
          htmlFor={urlId}
          label="Product URL"
        >
          <div className="flex gap-2">
            <Input
              autoComplete="url"
              id={urlId}
              onChange={onUrlChange}
              placeholder="https://example.com/product/thing"
              required
              type="url"
              value={url}
            />
            <Button disabled={fetchPreview.isPending} type="submit">
              {fetchPreview.isPending ? "Fetching…" : "Fetch preview"}
            </Button>
          </div>
        </Field>
      </form>

      {preview ? (
        <>
          <PreviewPanel
            isTesting={trimmedSelector.length > 0 && selectorTest.isFetching}
            onSelectorChange={setSelector}
            onTogglePicker={togglePicker}
            preview={preview}
            selector={selector}
            test={selectorTest.data}
            usingSelector={usingSelector}
          />
          <SavePanel
            chosen={chosen}
            extractorNote={extractorNote}
            isSaving={create.isPending}
            onSave={onSave}
            onTargetChange={onTargetChange}
            targetPrice={targetPrice}
          />
        </>
      ) : null}
    </div>
  );
}
