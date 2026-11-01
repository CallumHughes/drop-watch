"use client";

import type {
  ExpressionMode,
  PagePreview,
  PreviewAttemptSummary,
} from "@drop-watch/api/routers/preview";
import { PRICE_PATTERN } from "@drop-watch/api/schemas/products";
import { APP_NAME } from "@drop-watch/brand";
import { ORPCError } from "@orpc/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ChangeEvent, FormEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

import { isSingleMatchExtraction } from "./listing-repair";
import { automaticPreviewNeedsRepair, previewSelection } from "./preview-confidence";

/**
 * Long enough that a typed expression settles before it is tried, short enough
 * to feel live. It only spaces out server round trips — no fetch happens either
 * way, because the page is already in memory.
 */
const EXPRESSION_DEBOUNCE_MS = 300;

/** Where the advanced picker starts when the chain found nothing. */
const DEFAULT_MODE: ExpressionMode = "selector";

/** A price worth asking the server about — the same shape a target price takes. */
export function expectedPriceIsUsable(value: string): boolean {
  return PRICE_PATTERN.test(value.trim());
}

/**
 * Whether a located candidate should be pinned at all.
 *
 * When the chain already reads the price the user typed *and* the worker's gate
 * would accept it, pinning an expression adds a thing to rot for no gain. That
 * only arises when the picker was opened by hand: a preview needing repair is
 * one the gate refuses, so agreement there still needs a pin.
 */
export function automaticAlreadyReadsIt(
  automatic: { agrees: boolean; ambiguous: boolean } | null | undefined
): boolean {
  return Boolean(automatic?.agrees) && !automatic?.ambiguous;
}

/** Blank locale drafts should omit the optional preview locale input. */
export function normalizePreviewLocale(locale: string | null | undefined): string | undefined {
  return locale?.trim() || undefined;
}

/** A mutation result may update the flow only while its generation is active. */
export function isCurrentPreviewRequest(
  requestGeneration: number | undefined,
  currentGeneration: number
): boolean {
  return requestGeneration === currentGeneration;
}

/**
 * Why a browser attempt in this same preview already failed, or `null`.
 *
 * Automatic mode escalates to the browser on its own when HTTP is inconclusive.
 * When that escalation fails we still show the HTTP body, so without this the
 * panel would offer "Reload in browser" for an attempt that failed seconds ago
 * and charge another render to reach the same refusal.
 */
export function failedBrowserAttempt(
  preview: PagePreview | null
): (PreviewAttemptSummary & { message: string }) | null {
  const attempt = preview?.attempts.find(
    (candidate) =>
      candidate.transport === "browser" &&
      (candidate.status !== "ok" || candidate.challenge !== null)
  );
  if (!attempt) {
    return null;
  }
  return {
    ...attempt,
    message: attempt.challenge ?? attempt.error ?? `the browser attempt reported ${attempt.status}`,
  };
}

/**
 * A failed capability read is deliberately indistinguishable from loading here:
 * the browser request is still the authority on whether rendering can work.
 */
export function transportReloadControl({
  alreadyFailed,
  browserRender,
  currentRender,
  preconditionFailed,
}: {
  alreadyFailed: ReturnType<typeof failedBrowserAttempt>;
  browserRender: boolean | undefined;
  currentRender: PagePreview["render"];
  preconditionFailed: boolean;
}) {
  const target = currentRender === "http" ? "browser" : "http";
  const unavailable = target === "browser" && browserRender === false;
  const disabled =
    target === "browser" &&
    (unavailable ||
      preconditionFailed ||
      (alreadyFailed !== null && alreadyFailed.challenge !== null));
  return {
    alreadyFailed: target === "browser" ? (alreadyFailed?.message ?? null) : null,
    disabled,
    target,
    unavailable,
  };
}

function isPreconditionFailure(error: unknown): boolean {
  return error instanceof ORPCError && error.code === "PRECONDITION_FAILED";
}

/**
 * oRPC's own fallback messages, used when it could not parse an error response
 * body. Seeing one means something between the browser and DropWATCH replaced
 * the response — a reverse proxy substituting its own error page for a 5xx is
 * the usual cause — so the real reason is in the server's logs, not here.
 */
const ORPC_STATUS_FALLBACKS = new Set([
  "Bad Gateway",
  "Gateway Timeout",
  "Internal Server Error",
  "Service Unavailable",
]);

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Unable to reload the page preview.";
  }
  if (ORPC_STATUS_FALLBACKS.has(error.message)) {
    return `the server returned "${error.message}" with no detail. If ${APP_NAME} is behind a proxy, the reason is in its logs.`;
  }
  return error.message;
}

/**
 * The preview half shared by add-product and add-listing: paste a URL, see
 * what the extraction chain makes of it, fall back to a hand-written
 * expression when it makes nothing. Every edit reads the server's cached
 * preview rather than loading the page again.
 *
 * `mode` is the picker's state: `null` means the automatic result is what gets
 * saved, and any other value pins that strategy. Whichever half of the flow
 * produced a price is what `chosen` holds — the picker wins when it is open and
 * working, so a page whose JSON-LD quotes the wrong price can still be
 * corrected by hand. Saving itself is the caller's job; this hook only gets a
 * price onto the screen.
 */
export function usePreviewFlow({
  initialUrl = "",
  locale,
}: {
  initialUrl?: string;
  locale?: string;
} = {}) {
  const [url, setUrl] = useState(initialUrl);
  const [preview, setPreview] = useState<PagePreview | null>(null);
  const [mode, setMode] = useState<ExpressionMode | null>(null);
  const [expression, setExpression] = useState("");
  const [settledExpression, setSettledExpression] = useState("");
  const [expectedPrice, setExpectedPrice] = useState("");
  const [settledExpectedPrice, setSettledExpectedPrice] = useState("");
  const [transportReloadError, setTransportReloadError] = useState<string | null>(null);
  const [browserReloadPreconditionFailed, setBrowserReloadPreconditionFailed] = useState(false);
  const previewRequestGeneration = useRef(0);
  const previousLocale = useRef<string | undefined>(locale?.trim() || undefined);

  const localeInput = normalizePreviewLocale(locale);

  useEffect(() => {
    if (previousLocale.current === localeInput) {
      return;
    }
    previousLocale.current = localeInput;
    previewRequestGeneration.current += 1;
    setPreview(null);
    setMode(null);
    setExpression("");
    setSettledExpression("");
    setExpectedPrice("");
    setSettledExpectedPrice("");
    setTransportReloadError(null);
    setBrowserReloadPreconditionFailed(false);
  }, [localeInput]);

  useEffect(() => {
    const timer = setTimeout(() => setSettledExpression(expression), EXPRESSION_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [expression]);

  useEffect(() => {
    const timer = setTimeout(() => setSettledExpectedPrice(expectedPrice), EXPRESSION_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [expectedPrice]);

  const fetchPreview = useMutation(
    orpc.preview.page.mutationOptions({
      onError: (error, _variables, requestGeneration) => {
        if (!isCurrentPreviewRequest(requestGeneration, previewRequestGeneration.current)) {
          return;
        }
        toast.error(error.message);
      },
      onMutate: () => previewRequestGeneration.current,
      onSuccess: (data, _variables, requestGeneration) => {
        if (!isCurrentPreviewRequest(requestGeneration, previewRequestGeneration.current)) {
          return;
        }
        setPreview(data);
        // A new automatic preview clears picker state. If its automatic
        // extraction finds a price, the picker stays closed below.
        setExpression("");
        setSettledExpression("");
        setExpectedPrice("");
        setSettledExpectedPrice("");
        // Nothing matched automatically, so the picker is the next step rather
        // than an option buried behind a toggle.
        setMode(
          data.extraction === null || automaticPreviewNeedsRepair(data) ? DEFAULT_MODE : null
        );
      },
    })
  );

  const reloadPreview = useMutation(
    orpc.preview.page.mutationOptions({
      onError: (error, variables, requestGeneration) => {
        if (!isCurrentPreviewRequest(requestGeneration, previewRequestGeneration.current)) {
          return;
        }
        setTransportReloadError(errorMessage(error));
        if (variables.render === "browser" && isPreconditionFailure(error)) {
          setBrowserReloadPreconditionFailed(true);
        }
      },
      onMutate: () => {
        setTransportReloadError(null);
        return previewRequestGeneration.current;
      },
      onSuccess: (data, _variables, requestGeneration) => {
        if (!isCurrentPreviewRequest(requestGeneration, previewRequestGeneration.current)) {
          return;
        }
        setPreview(data);
        setExpression("");
        setSettledExpression("");
        setExpectedPrice("");
        setSettledExpectedPrice("");
        setMode(
          data.extraction === null || automaticPreviewNeedsRepair(data) ? DEFAULT_MODE : null
        );
        setTransportReloadError(null);
        setBrowserReloadPreconditionFailed(false);
      },
    })
  );

  const previewId = preview?.previewId ?? "";
  const trimmedExpression = settledExpression.trim();
  const expressionTest = useQuery(
    orpc.preview.testExpression.queryOptions({
      enabled: mode !== null && previewId !== "" && trimmedExpression.length > 0,
      input: {
        expression: trimmedExpression,
        mode: mode ?? DEFAULT_MODE,
        previewId,
        ...(localeInput ? { locale: localeInput } : {}),
      },
      // The cached body cannot change, so an expression already tried never
      // needs asking twice — and none of this ever touches the network.
      staleTime: Number.POSITIVE_INFINITY,
    })
  );
  const trimmedExpectedPrice = settledExpectedPrice.trim();
  const suggestion = useQuery(
    orpc.preview.suggestExpressions.queryOptions({
      enabled: previewId !== "" && expectedPriceIsUsable(trimmedExpectedPrice),
      input: {
        expectedPrice: trimmedExpectedPrice,
        previewId,
        ...(localeInput ? { locale: localeInput } : {}),
      },
      // Same reason as the expression test: the cached body cannot change, and
      // none of this touches the network.
      staleTime: Number.POSITIVE_INFINITY,
    })
  );
  const capabilities = useQuery(
    orpc.capabilities.queryOptions({
      enabled: preview?.render === "http",
      staleTime: Number.POSITIVE_INFINITY,
    })
  );
  const reloadControl = preview
    ? transportReloadControl({
        alreadyFailed: failedBrowserAttempt(preview),
        browserRender: capabilities.data?.browserRender,
        currentRender: preview.render,
        preconditionFailed: browserReloadPreconditionFailed,
      })
    : null;

  // Applying the top candidate rather than offering the list is the point of
  // the flow: choosing between two selectors that read the same number today
  // is the judgement nobody should have to make. Keyed on the query result, so
  // a hand-written expression in the advanced picker is never overwritten.
  const suggested = suggestion.data;
  useEffect(() => {
    const candidate = suggested?.candidates[0];
    if (!candidate || automaticAlreadyReadsIt(suggested?.automatic)) {
      return;
    }
    setMode(candidate.mode);
    setExpression(candidate.expression);
    setSettledExpression(candidate.expression);
  }, [suggested]);

  const onExpectedPriceChange = useCallback((next: string) => {
    setExpectedPrice(next);
  }, []);
  /** Picking one of the page's own prices re-asks with that value. */
  const onPickPagePrice = useCallback((amount: string) => {
    setExpectedPrice(amount);
    setSettledExpectedPrice(amount);
  }, []);
  const onUrlChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    previewRequestGeneration.current += 1;
    setUrl(event.target.value);
    // A preview belongs to the exact URL that produced it. Dropping it here
    // prevents save actions from combining stale markup with a newly typed URL.
    setPreview(null);
    setTransportReloadError(null);
    setBrowserReloadPreconditionFailed(false);
  }, []);
  const togglePicker = useCallback(() => {
    setMode((current) => (current === null ? DEFAULT_MODE : null));
  }, []);
  // Switching mode re-reads the same expression in a new language, which is
  // almost never what was meant — a CSS selector is not a JSONPath.
  const onModeChange = useCallback((next: ExpressionMode) => {
    setMode(next);
    setExpression("");
    setSettledExpression("");
  }, []);
  const loadPreview = useCallback(() => {
    previewRequestGeneration.current += 1;
    setPreview(null);
    setTransportReloadError(null);
    setBrowserReloadPreconditionFailed(false);
    fetchPreview.mutate({
      render: "auto",
      url: url.trim(),
      ...(localeInput ? { locale: localeInput } : {}),
    });
  }, [fetchPreview, localeInput, url]);
  const reloadWithOtherTransport = useCallback(() => {
    if (!preview) {
      return;
    }
    previewRequestGeneration.current += 1;
    const render = preview.render === "http" ? "browser" : "http";
    reloadPreview.mutate({
      render,
      url: preview.url,
      ...(localeInput ? { locale: localeInput } : {}),
    });
  }, [localeInput, preview, reloadPreview]);
  const onFetch = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      loadPreview();
    },
    [loadPreview]
  );

  const expressionIsSettled = expression.trim() === trimmedExpression;
  const isTesting =
    trimmedExpression.length > 0 && (!expressionIsSettled || expressionTest.isFetching);

  // Whichever half of the flow produced a price is what gets saved. The picker
  // wins when it is open and working, so a page whose JSON-LD quotes the wrong
  // price can still be corrected by hand.
  const expressionExtraction =
    mode !== null &&
    trimmedExpression.length > 0 &&
    expressionIsSettled &&
    !expressionTest.isFetching &&
    isSingleMatchExtraction(expressionTest.data)
      ? (expressionTest.data?.extraction ?? null)
      : null;
  // `automaticRepairRequired` belongs to the preview itself and must stay true
  // after a manual expression succeeds, so a low-confidence result can never
  // switch back to automatic mode.
  const selection = previewSelection({
    manualExtraction: expressionExtraction,
    mode,
    preview,
  });
  const { automaticRepairRequired, chosen } = selection;
  const savingWithExpression = mode !== null && expressionExtraction !== null;
  const reset = useCallback(() => {
    previewRequestGeneration.current += 1;
    setUrl(initialUrl);
    setPreview(null);
    setMode(null);
    setExpression("");
    setSettledExpression("");
    setExpectedPrice("");
    setSettledExpectedPrice("");
    setTransportReloadError(null);
    setBrowserReloadPreconditionFailed(false);
  }, [initialUrl]);

  const isLocating =
    expectedPriceIsUsable(expectedPrice) &&
    (expectedPrice.trim() !== trimmedExpectedPrice || suggestion.isFetching);

  return {
    automaticRepairRequired,
    chosen,
    expectedPrice,
    expression,
    expressionTest,
    fetchPreview,
    isLocating,
    isTesting,
    loadPreview,
    mode,
    onExpectedPriceChange,
    onExpressionChange: setExpression,
    onFetch,
    onModeChange,
    onPickPagePrice,
    onUrlChange,
    preview,
    reset,
    savingWithExpression,
    suggestion,
    togglePicker,
    transportReload: reloadControl
      ? {
          error: transportReloadError,
          isPending: reloadPreview.isPending,
          onReload: reloadWithOtherTransport,
          ...reloadControl,
        }
      : null,
    trimmedExpression,
    url,
  };
}

export type PreviewFlow = ReturnType<typeof usePreviewFlow>;
