"use client";

import type { Listing } from "@drop-watch/api/routers/products";
import {
  MAX_INTERVAL_MINUTES,
  MAX_JITTER_PERCENT,
  MAX_SELECTOR_LENGTH,
  MIN_INTERVAL_MINUTES,
} from "@drop-watch/api/schemas/products";
import { Button } from "@drop-watch/ui/components/button";
import { Checkbox } from "@drop-watch/ui/components/checkbox";
import { Input } from "@drop-watch/ui/components/input";
import { Label } from "@drop-watch/ui/components/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, type FormEvent, useCallback, useId, useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

import { browserToggleState } from "./render-mode";

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
 * One listing's schedule and extraction — interval, jitter, extractor/selector,
 * locale. Identity and alert configuration stay product-level, in
 * `WatchSettingsForm`; this is the half that differs per store.
 *
 * The selector guardrail mirrors the server's: `listings.update` rejects
 * `extractor: "selector"` with no selector, so the form checks the same thing
 * before it ever sends the request.
 */
export function ListingSettingsForm({
  listing,
  onSaved,
}: {
  listing: Listing;
  onSaved?: () => void;
}) {
  const queryClient = useQueryClient();
  const intervalId = useId();
  const jitterId = useId();
  const localeId = useId();
  const selectorId = useId();
  const renderHintId = useId();

  const [intervalMinutes, setIntervalMinutes] = useState(String(listing.intervalMinutes));
  const [jitterPercent, setJitterPercent] = useState(String(listing.jitterPercent));
  const [extractor, setExtractor] = useState(listing.extractor);
  const [selector, setSelector] = useState(listing.selector ?? "");
  const [locale, setLocale] = useState(listing.locale ?? "");
  const [renderMode, setRenderMode] = useState(listing.render);

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
  const onSelectorChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setSelector(event.target.value);
  }, []);
  const onLocaleChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setLocale(event.target.value);
  }, []);
  const toggleSelectorMode = useCallback((checked: boolean) => {
    setExtractor(checked ? "selector" : "auto");
  }, []);
  const toggleBrowserRender = useCallback((checked: boolean) => {
    setRenderMode(checked ? "browser" : "http");
  }, []);

  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (extractor === "selector" && selector.trim() === "") {
        toast.error("A selector-mode listing needs a selector");
        return;
      }
      update.mutate(
        {
          extractor,
          id: listing.id,
          intervalMinutes: Number(intervalMinutes),
          jitterPercent: Number(jitterPercent),
          locale: locale.trim() === "" ? null : locale.trim(),
          render: renderMode,
          selector: extractor === "selector" ? selector.trim() : null,
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
      extractor,
      intervalMinutes,
      jitterPercent,
      listing.id,
      locale,
      onSaved,
      queryClient,
      renderMode,
      selector,
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

      <Label className="gap-2">
        <Checkbox checked={extractor === "selector"} onCheckedChange={toggleSelectorMode} />
        Use a CSS selector instead of automatic extraction
      </Label>

      {extractor === "selector" ? (
        <Field htmlFor={selectorId} label="CSS selector for the price">
          <Input
            autoComplete="off"
            id={selectorId}
            maxLength={MAX_SELECTOR_LENGTH}
            onChange={onSelectorChange}
            placeholder=".price, [itemprop='price'] …"
            spellCheck={false}
            value={selector}
          />
        </Field>
      ) : null}

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
        <Button disabled={update.isPending} size="sm" type="submit">
          {update.isPending ? "Saving…" : "Save listing settings"}
        </Button>
      </div>
    </form>
  );
}
