"use client";

import type { ExpressionMode, PagePreview } from "@drop-watch/api/routers/preview";
import { ORPCError } from "@orpc/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ChangeEvent, FormEvent } from "react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

/**
 * Long enough that a typed expression settles before it is tried, short enough
 * to feel live. It only spaces out server round trips — no fetch happens either
 * way, because the page is already in memory.
 */
const EXPRESSION_DEBOUNCE_MS = 300;

/** Where the picker starts when the chain found nothing: the familiar one. */
const DEFAULT_MODE: ExpressionMode = "selector";

/**
 * A failed capability read is deliberately indistinguishable from loading here:
 * the browser request is still the authority on whether rendering can work.
 */
export function browserReloadControl({
  browserRender,
  preconditionFailed,
}: {
  browserRender: boolean | undefined;
  preconditionFailed: boolean;
}) {
  const unavailable = browserRender === false;
  return { disabled: unavailable || preconditionFailed, unavailable };
}

function isPreconditionFailure(error: unknown): boolean {
  return error instanceof ORPCError && error.code === "PRECONDITION_FAILED";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to reload the page in a browser.";
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
export function usePreviewFlow() {
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<PagePreview | null>(null);
  const [mode, setMode] = useState<ExpressionMode | null>(null);
  const [expression, setExpression] = useState("");
  const [settledExpression, setSettledExpression] = useState("");
  const [browserReloadError, setBrowserReloadError] = useState<string | null>(null);
  const [browserReloadPreconditionFailed, setBrowserReloadPreconditionFailed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSettledExpression(expression), EXPRESSION_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [expression]);

  const fetchPreview = useMutation(
    orpc.preview.page.mutationOptions({
      onError: (error) => {
        toast.error(error.message);
      },
      onSuccess: (data) => {
        setPreview(data);
        // A new automatic preview clears picker state. If its automatic
        // extraction finds a price, the picker stays closed below.
        setExpression("");
        setSettledExpression("");
        // Nothing matched automatically, so the picker is the next step rather
        // than an option buried behind a toggle.
        setMode(data.extraction === null ? DEFAULT_MODE : null);
      },
    })
  );

  const reloadBrowserPreview = useMutation(
    orpc.preview.page.mutationOptions({
      onError: (error) => {
        setBrowserReloadError(errorMessage(error));
        if (isPreconditionFailure(error)) {
          setBrowserReloadPreconditionFailed(true);
        }
      },
      onMutate: () => {
        setBrowserReloadError(null);
      },
      onSuccess: (data) => {
        setPreview(data);
        setExpression("");
        setSettledExpression("");
        setMode(data.extraction === null ? DEFAULT_MODE : null);
        setBrowserReloadError(null);
      },
    })
  );

  const previewId = preview?.previewId ?? "";
  const trimmedExpression = settledExpression.trim();
  const expressionTest = useQuery(
    orpc.preview.testExpression.queryOptions({
      enabled: mode !== null && previewId !== "" && trimmedExpression.length > 0,
      input: { expression: trimmedExpression, mode: mode ?? DEFAULT_MODE, previewId },
      // The cached body cannot change, so an expression already tried never
      // needs asking twice — and none of this ever touches the network.
      staleTime: Number.POSITIVE_INFINITY,
    })
  );
  const capabilities = useQuery(
    orpc.capabilities.queryOptions({
      enabled: mode !== null && preview?.render === "http",
      staleTime: Number.POSITIVE_INFINITY,
    })
  );
  const reloadControl = browserReloadControl({
    browserRender: capabilities.data?.browserRender,
    preconditionFailed: browserReloadPreconditionFailed,
  });

  const onUrlChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setUrl(event.target.value);
    // A preview belongs to the exact URL that produced it. Dropping it here
    // prevents save actions from combining stale markup with a newly typed URL.
    setPreview(null);
    setBrowserReloadError(null);
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
    setPreview(null);
    setBrowserReloadError(null);
    setBrowserReloadPreconditionFailed(false);
    fetchPreview.mutate({ render: "auto", url: url.trim() });
  }, [fetchPreview, url]);
  const reloadInBrowser = useCallback(() => {
    if (!(preview?.render === "http")) {
      return;
    }
    reloadBrowserPreview.mutate({ render: "browser", url: preview.url });
  }, [preview, reloadBrowserPreview]);
  const onFetch = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      loadPreview();
    },
    [loadPreview]
  );

  // Whichever half of the flow produced a price is what gets saved. The picker
  // wins when it is open and working, so a page whose JSON-LD quotes the wrong
  // price can still be corrected by hand.
  const expressionExtraction = mode === null ? null : (expressionTest.data?.extraction ?? null);
  const chosen = expressionExtraction ?? preview?.extraction ?? null;
  const savingWithExpression = expressionExtraction !== null;

  return {
    browserReload: {
      error: browserReloadError,
      isPending: reloadBrowserPreview.isPending,
      onReload: reloadInBrowser,
      ...reloadControl,
    },
    chosen,
    expression,
    expressionTest,
    fetchPreview,
    isTesting: trimmedExpression.length > 0 && expressionTest.isFetching,
    mode,
    onExpressionChange: setExpression,
    onFetch,
    onModeChange,
    onUrlChange,
    preview,
    savingWithExpression,
    togglePicker,
    trimmedExpression,
    url,
  };
}

export type PreviewFlow = ReturnType<typeof usePreviewFlow>;
