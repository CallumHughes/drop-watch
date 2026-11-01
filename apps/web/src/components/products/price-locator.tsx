"use client";

import type { SuggestedPrice } from "@drop-watch/api/routers/preview";
import { PRICE_PATTERN_SOURCE } from "@drop-watch/api/schemas/products";
import { Input } from "@drop-watch/ui/components/input";
import { type ChangeEvent, useCallback, useId } from "react";
import { formatPrice } from "@/lib/format";

import {
  ABSENT_MESSAGE,
  ELSEWHERE_MESSAGE,
  expectedPriceLabel,
  LOCATOR_HINT,
  type LocatorOutcome,
  missingCurrencyWarning,
} from "./locate-price";

function PagePrice({ onPick, price }: { onPick: (amount: string) => void; price: SuggestedPrice }) {
  const pick = useCallback(() => onPick(price.amount), [onPick, price.amount]);
  return (
    <li>
      <button
        className="rounded border px-2 py-1 text-left text-xs hover:border-foreground/40"
        onClick={pick}
        type="button"
      >
        <span className="block font-medium">{formatPrice(price.amount, price.currency)}</span>
        <code className="block truncate text-muted-foreground">{price.context}</code>
      </button>
    </li>
  );
}

/**
 * What was found, never how it was found.
 *
 * The expression is deliberately absent: the reader's job is to confirm this is
 * the right occurrence of their number, which the surrounding markup answers
 * and a selector does not.
 */
function Located({ outcome }: { outcome: Extract<LocatorOutcome, { kind: "located" }> }) {
  const { candidate } = outcome;
  return (
    <div className="flex flex-col gap-1 rounded-md border border-emerald-600/40 p-3">
      <p className="text-sm">Found that price here, and this listing will be tracked from it.</p>
      <p className="rounded bg-muted px-2 py-1 text-xs">
        <span className="block truncate font-medium">{candidate.sample.value || "(no value)"}</span>
        <code className="block truncate text-muted-foreground">{candidate.sample.context}</code>
      </p>
      <p className="text-muted-foreground text-xs">{candidate.reason}</p>
    </div>
  );
}

/**
 * The one question this flow asks: what price does the page show?
 *
 * Everything the engine works out from the answer — which strategy, which
 * element, which path — stays behind it. The caller owns the value and the
 * suggestion query, so what is shown and what will be saved cannot drift.
 */
export function PriceLocator({
  automaticNote,
  currency,
  expectedPrice,
  onExpectedPriceChange,
  onPickPagePrice,
  outcome,
}: {
  automaticNote: string | null;
  currency: string | null;
  expectedPrice: string;
  onExpectedPriceChange: (value: string) => void;
  onPickPagePrice: (amount: string) => void;
  outcome: LocatorOutcome;
}) {
  const priceId = useId();
  const onChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => onExpectedPriceChange(event.target.value),
    [onExpectedPriceChange]
  );
  const currencyWarning = missingCurrencyWarning(outcome, currency);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs" htmlFor={priceId}>
          {expectedPriceLabel(currency)}
        </label>
        <Input
          autoComplete="off"
          id={priceId}
          inputMode="decimal"
          onChange={onChange}
          pattern={PRICE_PATTERN_SOURCE}
          placeholder="24.99"
          value={expectedPrice}
        />
        <p className="text-muted-foreground text-xs">{LOCATOR_HINT}</p>
      </div>

      {automaticNote ? (
        <p className="text-muted-foreground text-xs" role="status">
          {automaticNote}
        </p>
      ) : null}

      {outcome.kind === "searching" ? (
        <p className="text-muted-foreground text-xs">Looking for that price on the page…</p>
      ) : null}

      {outcome.kind === "automatic" ? (
        <p className="text-sm">
          Nothing to configure: read automatically, this page already gives{" "}
          {formatPrice(outcome.price, currency)}. Use the automatic result.
        </p>
      ) : null}

      {outcome.kind === "located" ? <Located outcome={outcome} /> : null}

      {outcome.kind === "elsewhere" ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm">{ELSEWHERE_MESSAGE}</p>
          <ul className="flex flex-wrap gap-2">
            {outcome.prices.map((price) => (
              <PagePrice
                key={`${price.amount}:${price.currency ?? ""}`}
                onPick={onPickPagePrice}
                price={price}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {outcome.kind === "absent" ? (
        <p className="text-amber-700 text-sm dark:text-amber-300" role="alert">
          {ABSENT_MESSAGE}
        </p>
      ) : null}

      {currencyWarning ? (
        <p className="text-amber-700 text-xs dark:text-amber-300" role="alert">
          {currencyWarning}
        </p>
      ) : null}
    </div>
  );
}
