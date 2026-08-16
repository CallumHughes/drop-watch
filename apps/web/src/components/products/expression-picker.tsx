"use client";

import type { ExpressionMode, ExpressionPreview } from "@drop-watch/api/routers/preview";
import { Button } from "@drop-watch/ui/components/button";
import { Input } from "@drop-watch/ui/components/input";
import type { ChangeEvent } from "react";
import { useCallback, useId } from "react";

import { PreviewSource } from "./preview-source";
import { PreviewSummary } from "./preview-summary";

/**
 * The two ways to point at a price by hand, in the order worth trying.
 *
 * A CSS selector reaches visible price text and, with an explicit terminal
 * attribute suffix, values stored on an element. JSONPath remains for values
 * that only live in embedded JSON payloads.
 */
const MODES: readonly {
  hint: string;
  label: string;
  mode: ExpressionMode;
  placeholder: string;
  suggestions: readonly string[];
}[] = [
  {
    hint: "For an attribute value, append ::attr(attribute-name), for example [data-price]::attr(data-price). If the page provides no currency elsewhere, the attribute should include its symbol or code. Tested against the page fetched above — typing here never re-downloads it.",
    label: "CSS selector",
    mode: "selector",
    placeholder: ".price, [data-price]::attr(data-price) …",
    suggestions: [
      ".price",
      ".product-price",
      "[itemprop='price']",
      "[data-price]::attr(data-price)",
    ],
  },
  {
    hint: "Searched across every JSON payload on the page, including __NEXT_DATA__ and inline state.",
    label: "JSONPath",
    mode: "jsonpath",
    placeholder: "$..price",
    suggestions: ["$..price", "$..offers.price", "$.props.pageProps.product.price"],
  },
];

function ModeButton({
  active,
  label,
  mode,
  onPick,
}: {
  active: boolean;
  label: string;
  mode: ExpressionMode;
  onPick: (mode: ExpressionMode) => void;
}) {
  const pick = useCallback(() => onPick(mode), [mode, onPick]);
  return (
    <button
      aria-pressed={active}
      className={
        active
          ? "rounded border border-foreground/40 bg-muted px-2 py-1 font-medium text-xs"
          : "rounded border px-2 py-1 text-muted-foreground text-xs hover:text-foreground"
      }
      onClick={pick}
      type="button"
    >
      {label}
    </button>
  );
}

function Suggestion({
  expression,
  onPick,
}: {
  expression: string;
  onPick: (expression: string) => void;
}) {
  const pick = useCallback(() => onPick(expression), [expression, onPick]);
  return (
    <button
      className="rounded border px-2 py-0.5 text-muted-foreground text-xs hover:text-foreground"
      onClick={pick}
      type="button"
    >
      {expression}
    </button>
  );
}

function MatchList({ samples }: { samples: ExpressionPreview["samples"] }) {
  return (
    <ul className="flex flex-col gap-1">
      {samples.map((sample) => (
        <li
          className="rounded bg-muted px-2 py-1 text-xs"
          key={`${sample.context}:${sample.value}`}
        >
          <span className="block truncate font-medium">{sample.value || "(no value)"}</span>
          <code className="block truncate text-muted-foreground">{sample.context}</code>
        </li>
      ))}
    </ul>
  );
}

function Verdict({ test, url }: { test: ExpressionPreview; url: string }) {
  if (test.invalidExpression) {
    return <p className="text-muted-foreground text-xs">{test.invalidReason}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-xs">
        {test.matchCount === 1 ? "1 match" : `${test.matchCount} matches`}
      </p>
      <MatchList samples={test.samples} />
      {test.extraction ? (
        <div className="rounded-md border border-emerald-600/40 p-3">
          <PreviewSummary extraction={test.extraction} url={url} />
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">{test.extractionError}</p>
      )}
    </div>
  );
}

function BrowserReload({
  reload,
}: {
  reload: {
    disabled: boolean;
    error: string | null;
    isPending: boolean;
    onReload: () => void;
    unavailable: boolean;
  };
}) {
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
          {reload.isPending ? "Reloading in browser…" : "Reload in browser"}
        </Button>
      </div>
      {reload.unavailable ? (
        <p className="text-muted-foreground text-xs" role="status">
          Browser rendering is not configured on this instance. Set <code>RENDER_URL</code> and
          restart to enable it.
        </p>
      ) : null}
      {reload.isPending ? (
        <p className="text-muted-foreground text-xs" role="status">
          Loading the page in a browser. Your HTTP preview remains available while this runs.
        </p>
      ) : null}
      {reload.error ? (
        <p className="text-destructive text-xs" role="alert">
          Could not reload in a browser: {reload.error}{" "}
          {reload.disabled
            ? "This action is unavailable for the rest of this form."
            : "You can try again."}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The manual escape hatch: choose how to point at the price, type it, and see
 * immediately what it matches and what price falls out of it.
 *
 * Every test here runs server-side against the HTML fetched once when the
 * preview was created — no keystroke re-downloads the page. The caller owns the
 * expression string and the query; this component only shows the verdict, which
 * keeps the value that gets saved and the value being tested the same thing.
 */
export function ExpressionPicker({
  expression,
  isPending,
  mode,
  onExpressionChange,
  onModeChange,
  previewId,
  reloadInBrowser,
  test,
  url,
}: {
  expression: string;
  isPending: boolean;
  mode: ExpressionMode;
  onExpressionChange: (expression: string) => void;
  onModeChange: (mode: ExpressionMode) => void;
  previewId: string;
  reloadInBrowser?: {
    disabled: boolean;
    error: string | null;
    isPending: boolean;
    onReload: () => void;
    unavailable: boolean;
  };
  test: ExpressionPreview | undefined;
  url: string;
}) {
  const expressionId = useId();
  const active = MODES.find((entry) => entry.mode === mode) ?? MODES[0];

  const onChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => onExpressionChange(event.target.value),
    [onExpressionChange]
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <span className="text-muted-foreground text-xs">How do you want to find the price?</span>
        <div className="flex flex-wrap gap-2">
          {MODES.map((entry) => (
            <ModeButton
              active={entry.mode === mode}
              key={entry.mode}
              label={entry.label}
              mode={entry.mode}
              onPick={onModeChange}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs" htmlFor={expressionId}>
          {active.label} for the price
        </label>
        <Input
          autoComplete="off"
          id={expressionId}
          onChange={onChange}
          placeholder={active.placeholder}
          spellCheck={false}
          value={expression}
        />
        <div className="flex flex-wrap gap-2 pt-1">
          {active.suggestions.map((suggestion) => (
            <Suggestion expression={suggestion} key={suggestion} onPick={onExpressionChange} />
          ))}
        </div>
      </div>

      {expression.trim().length === 0 ? (
        <p className="text-muted-foreground text-xs">{active.hint}</p>
      ) : null}
      {isPending && expression.trim().length > 0 ? (
        <p className="text-muted-foreground text-xs">Testing…</p>
      ) : null}
      {test && !isPending ? <Verdict test={test} url={url} /> : null}

      {reloadInBrowser ? <BrowserReload reload={reloadInBrowser} /> : null}

      <PreviewSource previewId={previewId} />
    </div>
  );
}
