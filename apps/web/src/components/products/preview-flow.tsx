"use client";

import type { PagePreview, SelectorPreview } from "@drop-watch/api/routers/preview";
import { Button } from "@drop-watch/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@drop-watch/ui/components/card";
import { Input } from "@drop-watch/ui/components/input";
import { useId } from "react";

import { productHost } from "@/lib/format";

import { PreviewSummary } from "./preview-summary";
import { SelectorPicker } from "./selector-picker";
import type { PreviewFlow as PreviewFlowState } from "./use-preview-flow";

/** A labelled control, shared by every step of the add-product/add-listing flows. */
export function Field({
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

/**
 * The URL-to-preview half of add-product and add-listing: paste a URL, fetch
 * it once, then show what the extraction chain (or a hand-picked selector)
 * made of it. The caller renders its own save step below this, reading
 * `flow.chosen`/`flow.preview` once a price is on the screen.
 */
export function PreviewFlow({ flow }: { flow: PreviewFlowState }) {
  const urlId = useId();

  return (
    <>
      <form className="flex flex-col gap-2" onSubmit={flow.onFetch}>
        <Field
          hint="The page is fetched once. Everything after that runs against that copy."
          htmlFor={urlId}
          label="Product URL"
        >
          <div className="flex gap-2">
            <Input
              autoComplete="url"
              id={urlId}
              onChange={flow.onUrlChange}
              placeholder="https://example.com/product/thing"
              required
              type="url"
              value={flow.url}
            />
            <Button disabled={flow.fetchPreview.isPending} type="submit">
              {flow.fetchPreview.isPending ? "Fetching…" : "Fetch preview"}
            </Button>
          </div>
        </Field>
      </form>

      {flow.preview ? (
        <PreviewPanel
          isTesting={flow.isTesting}
          onSelectorChange={flow.onSelectorChange}
          onTogglePicker={flow.togglePicker}
          preview={flow.preview}
          selector={flow.selector}
          test={flow.selectorTest.data}
          usingSelector={flow.usingSelector}
        />
      ) : null}
    </>
  );
}
