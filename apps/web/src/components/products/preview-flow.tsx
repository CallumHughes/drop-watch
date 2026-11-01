"use client";

import type { PagePreview } from "@drop-watch/api/routers/preview";
import { Button } from "@drop-watch/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@drop-watch/ui/components/card";
import { Input } from "@drop-watch/ui/components/input";
import { useId } from "react";

import { productHost } from "@/lib/format";

import { ExpressionPicker } from "./expression-picker";
import { automaticDisagreementNote, locatorOutcome } from "./locate-price";
import { automaticPreviewRepairMessage } from "./preview-confidence";
import { PreviewSummary } from "./preview-summary";
import { PriceLocator } from "./price-locator";
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

function TransportReload({ reload }: { reload: NonNullable<PreviewFlowState["transportReload"]> }) {
  const targetsBrowser = reload.target === "browser";
  const actionLabel = targetsBrowser ? "Reload in browser" : "Reload with HTTP";
  const pendingLabel = targetsBrowser ? "Reloading in browser…" : "Reloading with HTTP…";
  const buttonLabel = reload.isPending ? pendingLabel : actionLabel;
  const errorPrefix = targetsBrowser
    ? "Could not reload in a browser:"
    : "Could not reload with HTTP:";

  return (
    <div className="flex flex-col gap-1">
      <div>
        <Button
          disabled={reload.disabled || reload.isPending}
          onClick={reload.onReload}
          size="sm"
          type="button"
          variant="outline"
        >
          {buttonLabel}
        </Button>
      </div>
      {reload.unavailable ? (
        <p className="text-muted-foreground text-xs" role="status">
          Browser rendering is not configured on this instance. Set <code>RENDER_URL</code> and
          restart to enable it.
        </p>
      ) : null}
      {reload.alreadyFailed ? (
        <p className="text-muted-foreground text-xs" role="status">
          This preview already tried a browser and it failed: {reload.alreadyFailed}
        </p>
      ) : null}
      {reload.isPending ? (
        <p className="text-muted-foreground text-xs" role="status">
          {targetsBrowser
            ? "Loading the page in a browser. Your HTTP preview remains available while this runs."
            : "Loading the page with plain HTTP. Your browser preview remains available while this runs."}
        </p>
      ) : null}
      {reload.error ? (
        <p className="text-destructive text-xs" role="alert">
          {errorPrefix} {reload.error}{" "}
          {reload.disabled
            ? "This action is unavailable for the rest of this form."
            : "You can try again."}
        </p>
      ) : null}
    </div>
  );
}

/**
 * What the chain found, and — when it needs correcting — the one question that
 * corrects it.
 *
 * Writing an expression lives behind a closed disclosure. It is still the only
 * thing that gets saved, but choosing it is the engine's job now: a reader can
 * see the price and should not have to describe where it is.
 */
function PreviewPanel({
  currency,
  flow,
  preview,
}: {
  currency: string | null;
  flow: PreviewFlowState;
  preview: PagePreview;
}) {
  const { mode, suggestion, transportReload } = flow;
  const requiresManualRepair = flow.automaticRepairRequired;
  const outcome = locatorOutcome({
    error: suggestion.error,
    expectedPrice: flow.expectedPrice,
    isLocating: flow.isLocating,
    suggestion: suggestion.data,
  });

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
            {requiresManualRepair ? (
              <p className="text-amber-700 text-sm dark:text-amber-300" role="alert">
                {automaticPreviewRepairMessage(preview)}
              </p>
            ) : (
              <div>
                <Button
                  disabled={transportReload?.isPending}
                  onClick={flow.togglePicker}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {mode === null ? "Set the price myself" : "Use the automatic result"}
                </Button>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm">
            Nothing matched automatically: {preview.extractionError}. Tell us the price the page
            shows and we’ll find where it comes from.
          </p>
        )}

        {transportReload ? <TransportReload reload={transportReload} /> : null}

        {mode === null ? null : (
          <div className="flex flex-col gap-4">
            <PriceLocator
              automaticNote={automaticDisagreementNote(suggestion.data, flow.expectedPrice)}
              currency={currency}
              expectedPrice={flow.expectedPrice}
              onExpectedPriceChange={flow.onExpectedPriceChange}
              onPickPagePrice={flow.onPickPagePrice}
              outcome={outcome}
            />
            {/* Native `details` rather than a primitive: it needs no JavaScript
                to open, and it is the escape hatch for a page whose price the
                engine cannot read at all. */}
            <details className="rounded-md border border-dashed p-3">
              <summary className="cursor-pointer text-muted-foreground text-xs">
                Advanced: point at the price with a CSS selector or JSONPath
              </summary>
              <div className="pt-3">
                <ExpressionPicker
                  expression={flow.expression}
                  isPending={flow.isTesting}
                  mode={mode}
                  onExpressionChange={flow.onExpressionChange}
                  onModeChange={flow.onModeChange}
                  previewId={preview.previewId}
                  test={flow.expressionTest.data}
                  url={preview.url}
                />
              </div>
            </details>
          </div>
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
export function PreviewFlow({
  currency = null,
  flow,
  lockUrl = false,
}: {
  /** The listing's recorded currency, used when the page itself gives none. */
  currency?: string | null;
  flow: PreviewFlowState;
  lockUrl?: boolean;
}) {
  const urlId = useId();
  const isLoadingPreview = flow.fetchPreview.isPending || Boolean(flow.transportReload?.isPending);
  const fetchButtonLabel = flow.fetchPreview.isPending ? "Loading…" : "Load preview";

  return (
    <>
      {lockUrl ? (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-xs">
            Re-preview this listing URL, then tell us the price its page shows now.
          </p>
          <div>
            <Button disabled={isLoadingPreview} onClick={flow.loadPreview} type="button">
              {fetchButtonLabel === "Loading…" ? "Re-previewing…" : "Re-preview listing"}
            </Button>
          </div>
        </div>
      ) : (
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
      )}

      {flow.preview ? (
        <PreviewPanel
          currency={currency ?? flow.preview.extraction?.currency ?? null}
          flow={flow}
          preview={flow.preview}
        />
      ) : null}
    </>
  );
}
