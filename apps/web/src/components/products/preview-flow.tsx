"use client";

import type {
  ExpressionMode,
  ExpressionPreview,
  PagePreview,
} from "@drop-watch/api/routers/preview";
import { Button } from "@drop-watch/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@drop-watch/ui/components/card";
import { Input } from "@drop-watch/ui/components/input";
import { useId } from "react";

import { productHost } from "@/lib/format";

import { ExpressionPicker } from "./expression-picker";
import { PreviewSummary } from "./preview-summary";
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
  browserReload,
  expression,
  isTesting,
  mode,
  onExpressionChange,
  onModeChange,
  onTogglePicker,
  preview,
  test,
}: {
  browserReload: PreviewFlowState["browserReload"];
  expression: string;
  isTesting: boolean;
  mode: ExpressionMode | null;
  onExpressionChange: (expression: string) => void;
  onModeChange: (mode: ExpressionMode) => void;
  onTogglePicker: () => void;
  preview: PagePreview;
  test: ExpressionPreview | undefined;
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
          {preview.render === "browser" ? " · rendered in a browser" : ""}
        </p>

        {preview.extraction ? (
          <>
            <PreviewSummary extraction={preview.extraction} url={preview.url} />
            <div>
              <Button
                disabled={browserReload.isPending}
                onClick={onTogglePicker}
                size="sm"
                type="button"
                variant="outline"
              >
                {mode === null ? "Pick the price myself" : "Use the automatic result"}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm">
            Nothing matched automatically: {preview.extractionError}. Pick the price yourself below.
          </p>
        )}

        {mode === null ? null : (
          <ExpressionPicker
            expression={expression}
            isPending={isTesting}
            mode={mode}
            onExpressionChange={onExpressionChange}
            onModeChange={onModeChange}
            previewId={preview.previewId}
            reloadInBrowser={preview.render === "http" ? browserReload : undefined}
            test={test}
            url={preview.url}
          />
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The URL-to-preview half of add-product and add-listing: paste a URL, fetch
 * it, then show what the extraction chain (or a hand-picked selector) made of
 * it. The caller renders its own save step below this, reading
 * `flow.chosen`/`flow.preview` once a price is on the screen.
 */
export function PreviewFlow({ flow }: { flow: PreviewFlowState }) {
  const urlId = useId();
  const isLoadingPreview = flow.fetchPreview.isPending || flow.browserReload.isPending;
  const fetchButtonLabel = flow.fetchPreview.isPending ? "Loading…" : "Load preview";

  return (
    <>
      <form className="flex flex-col gap-2" onSubmit={flow.onFetch}>
        <Field
          hint="We’ll look for the most reliable price we can find on this page."
          htmlFor={urlId}
          label="Product URL"
        >
          <div className="flex gap-2">
            <Input
              autoComplete="url"
              disabled={isLoadingPreview}
              id={urlId}
              onChange={flow.onUrlChange}
              placeholder="https://example.com/product/thing"
              required
              type="url"
              value={flow.url}
            />
            <Button disabled={isLoadingPreview} type="submit">
              {fetchButtonLabel}
            </Button>
          </div>
        </Field>
      </form>

      {flow.preview ? (
        <PreviewPanel
          browserReload={flow.browserReload}
          expression={flow.expression}
          isTesting={flow.isTesting}
          mode={flow.mode}
          onExpressionChange={flow.onExpressionChange}
          onModeChange={flow.onModeChange}
          onTogglePicker={flow.togglePicker}
          preview={flow.preview}
          test={flow.expressionTest.data}
        />
      ) : null}
    </>
  );
}
