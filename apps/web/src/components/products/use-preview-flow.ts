"use client";

import type { PagePreview } from "@drop-watch/api/routers/preview";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ChangeEvent, FormEvent } from "react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

/**
 * Long enough that a typed selector settles before it is tried, short enough to
 * feel live. It only spaces out server round trips — no fetch happens either
 * way, because the page is already in memory.
 */
const SELECTOR_DEBOUNCE_MS = 300;

/**
 * The preview half shared by add-product and add-listing: paste a URL, see
 * what the extraction chain makes of it, fall back to a hand-written CSS
 * selector when it makes nothing. The URL is fetched exactly once — every
 * selector edit after that reads the server's cached copy of that response.
 *
 * Whichever half of the flow produced a price is what `chosen` holds: the
 * picker wins when it is open and working, so a page whose JSON-LD quotes the
 * wrong price can still be corrected by hand. Saving itself is the caller's
 * job — this hook only gets a price onto the screen.
 */
export function usePreviewFlow() {
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<PagePreview | null>(null);
  const [usingSelector, setUsingSelector] = useState(false);
  const [selector, setSelector] = useState("");
  const [settledSelector, setSettledSelector] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setSettledSelector(selector), SELECTOR_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [selector]);

  const fetchPreview = useMutation(
    orpc.preview.page.mutationOptions({
      onError: (error) => {
        toast.error(error.message);
      },
      onSuccess: (data) => {
        setPreview(data);
        setSelector("");
        setSettledSelector("");
        // Nothing matched automatically, so the selector picker is the next
        // step rather than an option buried behind a toggle.
        setUsingSelector(data.extraction === null);
      },
    })
  );

  const previewId = preview?.previewId ?? "";
  const trimmedSelector = settledSelector.trim();
  const selectorTest = useQuery(
    orpc.preview.testSelector.queryOptions({
      enabled: usingSelector && previewId !== "" && trimmedSelector.length > 0,
      input: { previewId, selector: trimmedSelector },
      // The cached body cannot change, so a selector already tried never needs
      // asking twice — and none of this ever touches the network.
      staleTime: Number.POSITIVE_INFINITY,
    })
  );

  const onUrlChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setUrl(event.target.value);
  }, []);
  const togglePicker = useCallback(() => {
    setUsingSelector((current) => !current);
  }, []);
  const onFetch = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setPreview(null);
      fetchPreview.mutate({ url: url.trim() });
    },
    [fetchPreview, url]
  );

  // Whichever half of the flow produced a price is what gets saved. The picker
  // wins when it is open and working, so a page whose JSON-LD quotes the wrong
  // price can still be corrected by hand.
  const selectorExtraction = usingSelector ? (selectorTest.data?.extraction ?? null) : null;
  const chosen = selectorExtraction ?? preview?.extraction ?? null;
  const savingWithSelector = selectorExtraction !== null;

  return {
    chosen,
    fetchPreview,
    isTesting: trimmedSelector.length > 0 && selectorTest.isFetching,
    onFetch,
    onSelectorChange: setSelector,
    onUrlChange,
    preview,
    savingWithSelector,
    selector,
    selectorTest,
    togglePicker,
    trimmedSelector,
    url,
    usingSelector,
  };
}

export type PreviewFlow = ReturnType<typeof usePreviewFlow>;
