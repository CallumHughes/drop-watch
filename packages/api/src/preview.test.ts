import { describe, expect, it } from "vitest";

import { PreviewCache, type PreviewEntry, toPreviewExtraction } from "./preview";

const NOW = new Date("2026-07-27T12:00:00.000Z");

function at(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * 60_000);
}

function entry(url: string, storedAt = NOW): PreviewEntry {
  return { html: `<html lang="en">${url}</html>`, storedAt, url };
}

describe("PreviewCache", () => {
  it("returns a stored page", () => {
    const cache = new PreviewCache({ maxEntries: 3, ttlMs: 60_000 });
    cache.set("a", entry("https://example.com/a"), NOW);
    expect(cache.get("a", NOW)?.url).toBe("https://example.com/a");
  });

  it("forgets a page once its TTL has passed", () => {
    const cache = new PreviewCache({ maxEntries: 3, ttlMs: 60_000 });
    cache.set("a", entry("https://example.com/a"), NOW);
    expect(cache.get("a", at(0.5))?.url).toBe("https://example.com/a");
    expect(cache.get("a", at(2))).toBeUndefined();
    // The expired body is dropped, not merely hidden from the reader.
    expect(cache.size).toBe(0);
  });

  it("evicts the least recently used page when full", () => {
    const cache = new PreviewCache({ maxEntries: 2, ttlMs: 60_000 });
    cache.set("a", entry("https://example.com/a"), NOW);
    cache.set("b", entry("https://example.com/b"), NOW);
    // Touching "a" is what should save it from the next insert.
    cache.get("a", NOW);
    cache.set("c", entry("https://example.com/c"), NOW);

    expect(cache.get("a", NOW)).toBeDefined();
    expect(cache.get("b", NOW)).toBeUndefined();
    expect(cache.get("c", NOW)).toBeDefined();
    expect(cache.size).toBe(2);
  });

  it("prunes expired pages on write rather than letting them count towards the cap", () => {
    const cache = new PreviewCache({ maxEntries: 2, ttlMs: 60_000 });
    cache.set("old", entry("https://example.com/old"), NOW);
    cache.set("b", entry("https://example.com/b", at(2)), at(2));
    cache.set("c", entry("https://example.com/c", at(2)), at(2));

    expect(cache.size).toBe(2);
    expect(cache.get("old", at(2))).toBeUndefined();
    expect(cache.get("b", at(2))).toBeDefined();
    expect(cache.get("c", at(2))).toBeDefined();
  });

  it("overwrites an id in place instead of growing", () => {
    const cache = new PreviewCache({ maxEntries: 2, ttlMs: 60_000 });
    cache.set("a", entry("https://example.com/a"), NOW);
    cache.set("a", entry("https://example.com/a2"), NOW);
    expect(cache.size).toBe(1);
    expect(cache.get("a", NOW)?.url).toBe("https://example.com/a2");
  });
});

describe("toPreviewExtraction", () => {
  it("is null for a failed chain", () => {
    expect(toPreviewExtraction({ error: "no price found", ok: false })).toBeNull();
  });

  it("flattens absent optionals to null so the UI has one answer, not two", () => {
    expect(toPreviewExtraction({ ok: true, price: "12.99", strategy: "selector" })).toEqual({
      availability: null,
      currency: null,
      imageUrl: null,
      inStock: null,
      price: "12.99",
      strategy: "selector",
      title: null,
    });
  });

  it("keeps everything the chain did find, including a false inStock", () => {
    expect(
      toPreviewExtraction({
        availability: "OutOfStock",
        currency: "GBP",
        imageUrl: "https://example.com/a.jpg",
        inStock: false,
        ok: true,
        price: "1234.56",
        strategy: "jsonld",
        title: "A Thing",
      })
    ).toEqual({
      availability: "OutOfStock",
      currency: "GBP",
      imageUrl: "https://example.com/a.jpg",
      inStock: false,
      price: "1234.56",
      strategy: "jsonld",
      title: "A Thing",
    });
  });
});
