"use client";

import type { ExpressionMode, ExpressionPreview } from "@drop-watch/api/routers/preview";
import { Input } from "@drop-watch/ui/components/input";
import type { ChangeEvent } from "react";
import { useCallback, useId } from "react";

import { PreviewSource } from "./preview-source";
import { PreviewSummary } from "./preview-summary";

/**
 * The three ways to point at a price by hand, in the order worth trying.
 *
 * A CSS selector reaches anything that is text on the page; the other two exist
 * for the prices that are not — a value that only lives in an attribute or an
 * inline script, and one that only lives in an embedded JSON payload.
 */
const MODES: readonly {
  hint: string;
  label: string;
  mode: ExpressionMode;
  placeholder: string;
  suggestions: readonly string[];
}[] = [
  {
    hint: "Tested against the page fetched above — typing here never re-downloads it.",
    label: "CSS selector",
    mode: "selector",
    placeholder: ".price, [itemprop='price'] …",
    suggestions: [".price", ".product-price", "[itemprop='price']", "p.price_color"],
  },
  {
    hint: "The named group (?<price>…) wins, then the first capture group, then the whole match. Use [\\s\\S] to span lines.",
    label: "Regular expression",
    mode: "regex",
    placeholder: 'data-price="([\\d.]+)"',
    suggestions: ['data-price="([\\d.]+)"', '"price"\\s*:\\s*"?([\\d.]+)'],
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
  test,
  url,
}: {
  expression: string;
  isPending: boolean;
  mode: ExpressionMode;
  onExpressionChange: (expression: string) => void;
  onModeChange: (mode: ExpressionMode) => void;
  previewId: string;
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

      <PreviewSource previewId={previewId} />
    </div>
  );
}
