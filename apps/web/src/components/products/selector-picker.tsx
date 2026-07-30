"use client";

import type { SelectorPreview } from "@drop-watch/api/routers/preview";
import { Input } from "@drop-watch/ui/components/input";
import type { ChangeEvent } from "react";
import { useCallback, useId } from "react";

import { PreviewSource } from "./preview-source";
import { PreviewSummary } from "./preview-summary";

/** Selector guesses that cover most shops, offered as one-click starting points. */
const SUGGESTIONS = [".price", ".product-price", "[itemprop='price']", "p.price_color"] as const;

function Suggestion({
  onPick,
  selector,
}: {
  onPick: (selector: string) => void;
  selector: string;
}) {
  const pick = useCallback(() => onPick(selector), [onPick, selector]);
  return (
    <button
      className="rounded border px-2 py-0.5 text-muted-foreground text-xs hover:text-foreground"
      onClick={pick}
      type="button"
    >
      {selector}
    </button>
  );
}

function MatchList({ samples }: { samples: SelectorPreview["samples"] }) {
  return (
    <ul className="flex flex-col gap-1">
      {samples.map((sample) => (
        <li className="rounded bg-muted px-2 py-1 text-xs" key={sample.html}>
          <span className="block truncate font-medium">{sample.text || "(no text)"}</span>
          <code className="block truncate text-muted-foreground">{sample.html}</code>
        </li>
      ))}
    </ul>
  );
}

function Verdict({ test, url }: { test: SelectorPreview; url: string }) {
  if (test.invalidSelector) {
    return <p className="text-muted-foreground text-xs">Not valid CSS yet — keep typing.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-xs">
        {test.matchCount === 1 ? "1 element matches" : `${test.matchCount} elements match`}
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
 * The manual escape hatch: type a CSS selector, see immediately what it matches
 * and what price falls out of it.
 *
 * Every test here runs server-side against the HTML fetched once when the
 * preview was created — no keystroke re-downloads the page. The
 * caller owns the selector string and the query; this component only shows the
 * verdict, which keeps the value that gets saved and the value being tested the
 * same thing.
 */
export function SelectorPicker({
  isPending,
  onSelectorChange,
  previewId,
  selector,
  test,
  url,
}: {
  isPending: boolean;
  onSelectorChange: (selector: string) => void;
  previewId: string;
  selector: string;
  test: SelectorPreview | undefined;
  url: string;
}) {
  const selectorId = useId();

  const onChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => onSelectorChange(event.target.value),
    [onSelectorChange]
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs" htmlFor={selectorId}>
          CSS selector for the price
        </label>
        <Input
          autoComplete="off"
          id={selectorId}
          onChange={onChange}
          placeholder=".price, [itemprop='price'] …"
          spellCheck={false}
          value={selector}
        />
        <div className="flex flex-wrap gap-2 pt-1">
          {SUGGESTIONS.map((suggestion) => (
            <Suggestion key={suggestion} onPick={onSelectorChange} selector={suggestion} />
          ))}
        </div>
      </div>

      {selector.trim().length === 0 ? (
        <p className="text-muted-foreground text-xs">
          Tested against the page fetched above — typing here never re-downloads it.
        </p>
      ) : null}
      {isPending && selector.trim().length > 0 ? (
        <p className="text-muted-foreground text-xs">Testing…</p>
      ) : null}
      {test && !isPending ? <Verdict test={test} url={url} /> : null}

      <PreviewSource previewId={previewId} />
    </div>
  );
}
