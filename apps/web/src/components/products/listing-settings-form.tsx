"use client";

import type { Listing, ListingSummary } from "@drop-watch/api/routers/products";
import {
  MAX_INTERVAL_MINUTES,
  MAX_JITTER_PERCENT,
  MIN_INTERVAL_MINUTES,
  PINNED_NEEDS_EXPRESSION,
} from "@drop-watch/api/schemas/products";
import { Button } from "@drop-watch/ui/components/button";
import { Checkbox } from "@drop-watch/ui/components/checkbox";
import { Input } from "@drop-watch/ui/components/input";
import { Label } from "@drop-watch/ui/components/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, type FormEvent, useCallback, useId, useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";
import {
  type ListingExtractionSettings,
  listingExtractionNote,
  listingExtractionSettings,
  repairActionLabel,
  repairSummary,
  type TrackedPriceChange,
} from "./listing-repair";
import { PreviewFlow } from "./preview-flow";
import { browserToggleState } from "./render-mode";
import { type PreviewFlow as PreviewFlowState, usePreviewFlow } from "./use-preview-flow";

/**
 * A labelled control. The caller owns the id and hands the same one to its
 * input, which is what makes the label actually address the control rather
 * than merely sit above it.
 */
function Field({
  children,
  htmlFor,
  label,
}: {
  children: React.ReactNode;
  htmlFor: string;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-1 text-xs">
      <label className="text-muted-foreground" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * Re-preview this listing's own URL and apply a verified extraction to the
 * form above, without recreating the listing. The apply button names the
 * outcome, and `plan` spells it out, because switching back to automatic
 * clears a pinned expression.
 */
function RepairPanel({
  currency,
  current,
  flow,
  isOpen,
  onApply,
  onCancel,
  onOpen,
  pending,
  plan,
  tracked,
}: {
  currency: string | null;
  current: ListingExtractionSettings;
  flow: PreviewFlowState;
  isOpen: boolean;
  onApply: () => void;
  onCancel: () => void;
  onOpen: () => void;
  pending: boolean;
  plan: ListingExtractionSettings | null;
  tracked: TrackedPriceChange | undefined;
}) {
  const untestedPreview = Boolean(flow.preview) && !flow.chosen && !pending;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed p-3">
      <div>
        <p className="font-medium text-xs">Repair this listing’s price extraction</p>
        <p className="text-muted-foreground text-xs">
          Re-preview the current URL, tell us the price its page shows, and save the verified
          extraction without recreating this listing.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending} onClick={onOpen} size="sm" type="button" variant="outline">
          {flow.fetchPreview.isPending ? "Re-previewing…" : "Re-preview and repair"}
        </Button>
        {isOpen ? (
          <Button onClick={onCancel} size="sm" type="button" variant="ghost">
            Cancel repair
          </Button>
        ) : null}
      </div>
      {isOpen ? (
        <>
          <PreviewFlow currency={currency} flow={flow} lockUrl />
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={!plan} onClick={onApply} size="sm" type="button">
              {repairActionLabel(plan)}
            </Button>
            {plan ? (
              <p className="text-muted-foreground text-xs">
                {repairSummary(plan, current, tracked)}
              </p>
            ) : null}
            {untestedPreview ? (
              <p className="text-amber-700 text-xs dark:text-amber-300" role="alert">
                Enter the price this page shows before applying this repair.
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * One listing's schedule and extraction — interval, jitter, extractor/selector,
 * locale. Identity and alert configuration stay product-level, in
 * `WatchSettingsForm`; this is the half that differs per store.
 *
 * The selector guardrail mirrors the server's: `listings.update` rejects
 * `extractor: "selector"` with no selector, so the form checks the same thing
 * before it ever sends the request.
 */
export function ListingSettingsForm({
  latest,
  listing,
  onSaved,
}: {
  /** This listing's most recent observation, so a repair can name what changes. */
  latest?: ListingSummary["latest"];
  listing: Listing;
  onSaved?: () => void;
}) {
  const queryClient = useQueryClient();
  const intervalId = useId();
  const jitterId = useId();
  const localeId = useId();
  const renderHintId = useId();

  const [intervalMinutes, setIntervalMinutes] = useState(String(listing.intervalMinutes));
  const [jitterPercent, setJitterPercent] = useState(String(listing.jitterPercent));
  const [extractor, setExtractor] = useState(listing.extractor);
  const [expression, setExpression] = useState(listing.expression ?? "");
  const [locale, setLocale] = useState(listing.locale ?? "");
  const [renderMode, setRenderMode] = useState(listing.render);
  const [repairOpen, setRepairOpen] = useState(false);
  const repairFlow = usePreviewFlow({ initialUrl: listing.url, locale });

  // This form only mounts inside the expanded editor, so the query fires on
  // open rather than paying for it on every dashboard load.
  const capabilities = useQuery(
    orpc.capabilities.queryOptions({ staleTime: Number.POSITIVE_INFINITY })
  );
  // Unknown only while the query is in flight. A query that has *failed* must
  // report unavailable rather than unknown: `staleTime` is infinite, so it
  // will not retry for the life of this mount, and leaving it unknown would
  // disable the checkbox permanently — trapping a browser-mode listing in a
  // mode it can no longer be switched out of.
  // `listing`, not `renderMode`: the question is whether the saved row is
  // stuck in a mode this instance can no longer run. Answering it from the
  // draft would grey the checkbox out the moment it is unticked, before the
  // save, leaving no way to change your mind without reopening the editor.
  const browserToggle = browserToggleState({
    available: capabilities.isError ? false : capabilities.data?.browserRender,
    listing,
  });

  const update = useMutation(orpc.listings.update.mutationOptions());

  const onIntervalChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setIntervalMinutes(event.target.value);
  }, []);
  const onJitterChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setJitterPercent(event.target.value);
  }, []);
  const onLocaleChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setLocale(event.target.value);
  }, []);
  const toggleBrowserRender = useCallback((checked: boolean) => {
    setRenderMode(checked ? "browser" : "http");
  }, []);
  const loadRepairPreview = repairFlow.loadPreview;
  const repairPending =
    repairOpen &&
    (repairFlow.fetchPreview.isPending ||
      repairFlow.isLocating ||
      repairFlow.isTesting ||
      Boolean(repairFlow.transportReload?.isPending));
  const repairCanApply = Boolean(repairFlow.preview && repairFlow.chosen && !repairPending);
  // The form's draft, not the saved row: a repair is applied on top of edits
  // already made in this editor, and the summary has to describe those.
  const currentSettings: ListingExtractionSettings = {
    expression: extractor === "auto" ? null : expression.trim(),
    extractor,
    render: renderMode,
  };
  const repairPlan = repairCanApply ? listingExtractionSettings(repairFlow, currentSettings) : null;
  const tracked: TrackedPriceChange | undefined = repairFlow.chosen
    ? {
        currency: repairFlow.chosen.currency ?? latest?.currency ?? listing.currency,
        next: repairFlow.chosen.price,
        previous: latest?.price ?? null,
      }
    : undefined;
  const openRepair = useCallback(() => {
    setRepairOpen(true);
    loadRepairPreview();
  }, [loadRepairPreview]);
  const cancelRepair = useCallback(() => {
    setRepairOpen(false);
    repairFlow.reset();
  }, [repairFlow.reset]);
  const applyRepair = useCallback(() => {
    if (!repairPlan) {
      toast.error("Test exactly one price match before applying this repair.");
      return;
    }
    setExtractor(repairPlan.extractor);
    setExpression(repairPlan.expression ?? "");
    setRenderMode(repairPlan.render);
    setRepairOpen(false);
    repairFlow.reset();
  }, [repairFlow, repairPlan]);

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const nextExpression = extractor === "auto" ? null : expression.trim();
      if (extractor !== "auto" && !nextExpression) {
        toast.error(PINNED_NEEDS_EXPRESSION);
        return;
      }
      update.mutate(
        {
          expression: nextExpression,
          extractor,
          id: listing.id,
          intervalMinutes: Number(intervalMinutes),
          jitterPercent: Number(jitterPercent),
          locale: locale.trim() === "" ? null : locale.trim(),
          render: renderMode,
        },
        {
          onError: (error) => {
            toast.error(`Could not save: ${error.message}`);
          },
          onSuccess: () => {
            toast.success("Listing settings saved.");
            queryClient.invalidateQueries({ queryKey: orpc.products.key() });
            onSaved?.();
          },
        }
      );
    },
    [
      expression,
      extractor,
      intervalMinutes,
      jitterPercent,
      listing.id,
      locale,
      onSaved,
      queryClient,
      renderMode,
      update,
    ]
  );

  return (
    <form className="flex flex-col gap-3 border-foreground/10 border-t pt-3" onSubmit={onSubmit}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field htmlFor={intervalId} label="Check every (minutes)">
          <Input
            id={intervalId}
            max={MAX_INTERVAL_MINUTES}
            min={MIN_INTERVAL_MINUTES}
            onChange={onIntervalChange}
            required
            type="number"
            value={intervalMinutes}
          />
        </Field>
        <Field htmlFor={jitterId} label="Jitter (%)">
          <Input
            id={jitterId}
            max={MAX_JITTER_PERCENT}
            min={0}
            onChange={onJitterChange}
            required
            type="number"
            value={jitterPercent}
          />
        </Field>
        <Field htmlFor={localeId} label="Locale">
          <Input id={localeId} onChange={onLocaleChange} placeholder="none" value={locale} />
        </Field>
      </div>

      {/* Read-only: the repair panel below is the only way to change this, and
          it derives the expression from a price rather than asking for one. */}
      <div className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">How the price is found</span>
        <p>{listingExtractionNote(currentSettings)}</p>
      </div>

      <RepairPanel
        currency={listing.currency}
        current={currentSettings}
        flow={repairFlow}
        isOpen={repairOpen}
        onApply={applyRepair}
        onCancel={cancelRepair}
        onOpen={openRepair}
        pending={repairPending}
        plan={repairPlan}
        tracked={tracked}
      />

      <div className="flex flex-col gap-1">
        <Label className="items-start gap-2">
          <Checkbox
            aria-describedby={browserToggle.hint.kind === "none" ? undefined : renderHintId}
            checked={renderMode === "browser"}
            disabled={browserToggle.disabled}
            onCheckedChange={toggleBrowserRender}
          />
          <span>
            Load the page in a headless browser
            <span className="block text-muted-foreground">
              For stores that build their price with JavaScript. Slower than a plain fetch.
            </span>
          </span>
        </Label>
        {/* One id across both: the hints are mutually exclusive, and a
            disabled checkbox with no stated reason is the case that most
            needs the reason read out. */}
        {browserToggle.hint.kind === "unavailable-off" ? (
          <p className="text-muted-foreground text-xs" id={renderHintId}>
            No renderer is configured on this instance, so this option is unavailable. Set{" "}
            <code>RENDER_URL</code> and restart to enable it.
          </p>
        ) : null}
        {browserToggle.hint.kind === "unavailable-on" ? (
          <p className="text-muted-foreground text-xs" id={renderHintId}>
            This listing is set to use a browser, but no renderer is configured — its checks are
            failing. Set <code>RENDER_URL</code> and restart, or untick this.
          </p>
        ) : null}
      </div>

      <div>
        <Button disabled={update.isPending || repairPending} size="sm" type="submit">
          {update.isPending ? "Saving…" : "Save listing settings"}
        </Button>
      </div>
    </form>
  );
}
