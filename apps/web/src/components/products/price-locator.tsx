"use client";

import type { SuggestedPrice } from "@drop-watch/api/routers/preview";
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
  UNREACHABLE_MESSAGE,
  UNUSABLE_MESSAGE,
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

/** The page's own prices, offered as the answer to a question we got wrong. */
function PagePrices({
  message,
  onPick,
  prices,
}: {
  message: string;
  onPick: (amount: string) => void;
  prices: SuggestedPrice[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">{message}</p>
      {prices.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {prices.map((price) => (
            <PagePrice
              key={`${price.amount}:${price.currency ?? ""}`}
              onPick={onPick}
              price={price}
            />
          ))}
        </ul>
      ) : null}
    </div>
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
  const unusable = outcome.kind === "unusable";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs" htmlFor={priceId}>
          {expectedPriceLabel(currency)}
        </label>
        {/* No `pattern`: this input sits inside the listing settings form, and
            a native validity failure there blocks that form's submit entirely
            — a mistyped price would silently refuse to save the interval. The
            `unusable` outcome says the same thing without the side effect. */}
        <Input
          aria-invalid={unusable}
          autoComplete="off"
          id={priceId}
          inputMode="decimal"
          onChange={onChange}
          placeholder="24.99"
          value={expectedPrice}
        />
        <p className="text-muted-foreground text-xs">{LOCATOR_HINT}</p>
      </div>

      {unusable ? (
        <p className="text-amber-700 text-xs dark:text-amber-300" role="alert">
          {UNUSABLE_MESSAGE}
        </p>
      ) : null}

      {automaticNote ? (
        <p className="text-muted-foreground text-xs" role="status">
          {automaticNote}
        </p>
      ) : null}

      {outcome.kind === "searching" ? (
        <p className="text-muted-foreground text-xs">Looking for that price on the page…</p>
      ) : null}

      {outcome.kind === "failed" ? (
        <p className="text-amber-700 text-sm dark:text-amber-300" role="alert">
          {outcome.message}
        </p>
      ) : null}

      {outcome.kind === "automatic" ? (
        <p className="text-sm">
          Nothing to configure: read automatically, this page already gives{" "}
          {formatPrice(outcome.price, currency)}. Use the automatic result.
        </p>
      ) : null}

      {outcome.kind === "located" ? <Located outcome={outcome} /> : null}

      {outcome.kind === "elsewhere" ? (
        <PagePrices message={ELSEWHERE_MESSAGE} onPick={onPickPagePrice} prices={outcome.prices} />
      ) : null}

      {outcome.kind === "unreachable" ? (
        <div className="flex flex-col gap-2">
          <p className="text-amber-700 text-sm dark:text-amber-300" role="alert">
            {UNREACHABLE_MESSAGE}
          </p>
          {outcome.prices.length > 0 ? (
            <PagePrices
              message="The page also shows these:"
              onPick={onPickPagePrice}
              prices={outcome.prices}
            />
          ) : null}
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
