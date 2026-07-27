/**
 * The pure half of the add-product preview: the short-lived store that holds a
 * fetched page in memory, and the wire shape the picker renders.
 *
 * The plan is explicit that the selector picker must test against the HTML
 * fetched in step 2 rather than re-fetching per keystroke (PLAN.md §8), which
 * makes this cache the load-bearing part of the flow. Everything here is
 * deliberately free of database and network imports so it can be tested
 * without either — the router does the fetching, this does the remembering.
 */

import type {
  ExtractionResult,
  ExtractorStrategy,
  SelectorMatch,
  SelectorTest,
} from "@price-tracker/core/extract";

/** One fetched page, held only long enough to pick a selector against it. */
export interface PreviewEntry {
  /** Response body, verbatim. What every selector test is run against. */
  html: string;
  storedAt: Date;
  /** Final URL after redirects — the one that gets saved, not the one typed. */
  url: string;
}

export interface PreviewCacheOptions {
  /**
   * Hard ceiling on retained pages. Bodies run to megabytes, so this is a
   * memory bound rather than a hit-rate tuning knob.
   */
  maxEntries: number;
  ttlMs: number;
}

/**
 * A tiny TTL + LRU map of preview id → fetched page.
 *
 * Losing an entry is survivable by design: the UI re-previews, which costs one
 * fetch. That is why nothing here is persisted — a restarted web process
 * simply forgets in-progress previews.
 */
export class PreviewCache {
  private readonly entries = new Map<string, PreviewEntry>();
  private readonly options: PreviewCacheOptions;

  constructor(options: PreviewCacheOptions) {
    this.options = options;
  }

  get size(): number {
    return this.entries.size;
  }

  /** Drops everything past its TTL. Called on every read and write. */
  prune(now: Date = new Date()): void {
    for (const [id, entry] of this.entries) {
      if (this.isExpired(entry, now)) {
        this.entries.delete(id);
      }
    }
  }

  set(id: string, entry: PreviewEntry, now: Date = new Date()): void {
    this.prune(now);
    this.entries.delete(id);
    this.entries.set(id, entry);
    // Map iterates in insertion order, and a read re-inserts, so the first key
    // is always the least recently used.
    while (this.entries.size > this.options.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) {
        break;
      }
      this.entries.delete(oldest.value);
    }
  }

  /** The cached page, or `undefined` once it has expired or been evicted. */
  get(id: string, now: Date = new Date()): PreviewEntry | undefined {
    const entry = this.entries.get(id);
    if (!entry) {
      return;
    }
    if (this.isExpired(entry, now)) {
      this.entries.delete(id);
      return;
    }
    // Refresh recency so the page being actively worked on is never the one
    // evicted to make room.
    this.entries.delete(id);
    this.entries.set(id, entry);
    return entry;
  }

  private isExpired(entry: PreviewEntry, now: Date): boolean {
    return now.getTime() - entry.storedAt.getTime() > this.options.ttlMs;
  }
}

/**
 * What the chain found, flattened for the wire.
 *
 * `null` rather than absent throughout: the optional fields on
 * {@link ExtractionResult} exist so the extractors can omit what they did not
 * see, but a UI reading `imageUrl` wants one answer, not two ways of saying no.
 */
export interface PreviewExtraction {
  /** Bare schema.org token, e.g. "InStock". */
  availability: string | null;
  currency: string | null;
  imageUrl: string | null;
  inStock: boolean | null;
  /** Decimal string, exactly as it will be stored. */
  price: string;
  /** Which link in the chain won — the thing the preview exists to show. */
  strategy: ExtractorStrategy;
  title: string | null;
}

/** What one previewed page comes back as. */
export interface PagePreview {
  /** What was found, or `null` when the chain came up empty. */
  extraction: PreviewExtraction | null;
  /** Why it came up empty; `null` when it did not. */
  extractionError: string | null;
  /** Size of the cached body, so the UI can say what it is testing against. */
  htmlBytes: number;
  httpStatus: number;
  /** Handle for later selector tests. Meaningless once the entry expires. */
  previewId: string;
  /** Final URL after redirects. This, not the typed URL, is what gets saved. */
  url: string;
}

export function toPreviewExtraction(result: ExtractionResult): PreviewExtraction | null {
  if (!result.ok) {
    return null;
  }
  return {
    availability: result.availability ?? null,
    currency: result.currency ?? null,
    imageUrl: result.imageUrl ?? null,
    inStock: result.inStock ?? null,
    price: result.price,
    strategy: result.strategy,
    title: result.title ?? null,
  };
}

/**
 * What one candidate selector comes back as.
 *
 * Deliberately the same `extraction` / `extractionError` pair as
 * {@link PagePreview}: whichever way a price was found, the confirm step reads
 * one shape, and the two halves of the flow cannot drift apart.
 */
export interface SelectorPreview {
  extraction: PreviewExtraction | null;
  extractionError: string | null;
  /**
   * The selector is not valid CSS. Worth its own flag because it is what every
   * half-typed selector looks like, and should not read as "wrong selector".
   */
  invalidSelector: boolean;
  matchCount: number;
  /** The first few matched elements, for confirming the right one was hit. */
  samples: SelectorMatch[];
}

export function toSelectorPreview(test: SelectorTest): SelectorPreview {
  return {
    extraction: toPreviewExtraction(test.result),
    extractionError: test.result.ok ? null : test.result.error,
    invalidSelector: test.invalidSelector,
    matchCount: test.matchCount,
    samples: test.samples,
  };
}
