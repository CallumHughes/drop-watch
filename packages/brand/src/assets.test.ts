import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { MARK, WORDMARK_HORIZONTAL, WORDMARK_STACKED } from "./paths.generated";

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), "../assets");

const VIEW_BOX = /viewBox="([-\d.\s]+)"/;
const PATH_DATA = /<path[^>]*\sd="([^"]+)"/g;

const read = (name: string) => readFileSync(join(ASSETS, `${name}.svg`), "utf8");

function art(svg: string) {
  return {
    paths: [...svg.matchAll(PATH_DATA)].map((m) => m[1]),
    viewBox: svg.match(VIEW_BOX)?.[1] ?? "",
  };
}

/**
 * `paths.generated.ts` is written by `brand:generate` from the same SVGs the
 * rasters come from. Editing an asset without re-running it would leave the
 * React components drawing the old artwork while every PNG showed the new one,
 * and nothing else in the repo would notice.
 */
describe("the generated paths match the assets they came from", () => {
  it.each([
    ["mark", MARK],
    ["wordmark-horizontal", WORDMARK_HORIZONTAL],
    ["wordmark-stacked", WORDMARK_STACKED],
  ])("%s", (name, generated) => {
    expect(art(read(name))).toEqual({
      paths: [...generated.paths],
      viewBox: generated.viewBox,
    });
  });
});

/**
 * The app icons are a badge — the mark inside a filled square — so each one
 * carries a copy of its path data. `brand:generate` rebuilds them from the same
 * asset the components read, and this is what holds the two together.
 */
describe("the badges carry the mark", () => {
  it.each(["badge", "badge-maskable", "icon-scheme"])("%s", (name) => {
    const svg = read(name);
    for (const d of MARK.paths) {
      expect(svg).toContain(d);
    }
  });
});

describe("every asset is clean vector", () => {
  const files = readdirSync(ASSETS).filter((f) => f.endsWith(".svg"));

  it("ships some", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  // A raw Canva export carries the drop shadow as an embedded base64 PNG, which
  // is 97% of its weight and the only part that cannot scale.
  it.each(files)("%s has no embedded raster", (file) => {
    const svg = readFileSync(join(ASSETS, file), "utf8");
    expect(svg).not.toContain("<image");
    expect(svg).not.toContain("base64");
  });
});
