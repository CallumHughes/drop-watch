import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { BADGE, MARK, WORDMARK_HORIZONTAL, WORDMARK_STACKED } from "./paths.generated";
import { badgeRadiusPercent } from "./theme";

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), "../assets");
const THEME = join(dirname(fileURLToPath(import.meta.url)), "../../ui/src/styles/globals.css");

const VIEW_BOX = /viewBox="(?<viewBox>[-\d.\s]+)"/u;
const PATH_DATA = /<path[^>]*\sd="(?<d>[^"]+)"/gu;
const WHITESPACE = /\s+/u;
const WIDTH = /width="(?<w>[\d.]+)"/u;
const RX = /rx="(?<rx>[\d.]+)"/u;

const read = (name: string) => readFileSync(join(ASSETS, `${name}.svg`), "utf8");

function art(svg: string) {
  return {
    paths: [...svg.matchAll(PATH_DATA)].map((m) => m.groups?.d),
    viewBox: svg.match(VIEW_BOX)?.groups?.viewBox ?? "",
  };
}

function box(viewBox: string) {
  const [x = 0, y = 0, w = 0, h = 0] = viewBox.trim().split(WHITESPACE).map(Number);
  return { h, w, x, y };
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
    expect(art(read(name)).paths).toEqual([...generated.paths]);
  });
});

describe("the frame the components draw in", () => {
  it.each([
    ["mark", MARK],
    ["wordmark-stacked", WORDMARK_STACKED],
  ])("%s keeps the asset's own box", (name, generated) => {
    expect(art(read(name)).viewBox).toBe(generated.viewBox);
  });

  /**
   * The horizontal wordmark is the exception: its box stops at the "p"
   * descender, so centring it hangs the lettering high. `brand:generate`
   * mirrors that space above the caps instead. Same artwork and the same
   * baseline — only the top edge moves.
   */
  it("wordmark-horizontal is re-centred on its caps", () => {
    const asset = box(art(read("wordmark-horizontal")).viewBox);
    const drawn = box(WORDMARK_HORIZONTAL.viewBox);

    expect([drawn.x, drawn.w]).toEqual([asset.x, asset.w]);
    expect(drawn.y + drawn.h).toBeCloseTo(asset.y + asset.h, 1);

    // The space added above is the space below the baseline, and a baseline
    // past the half-way mark would not be one — so this bounds a measurement
    // that went wrong, not just the direction it went in.
    const added = asset.y - drawn.y;
    expect(added).toBeGreaterThan(0);
    expect(added).toBeLessThan(asset.h / 2);
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

describe("the badge component matches the favicon", () => {
  const svg = read("badge");

  it("has the same corner radius", () => {
    const side = Number(svg.match(WIDTH)?.groups?.w);
    const rx = Number(svg.match(RX)?.groups?.rx);
    expect(Number.parseFloat(BADGE.radius)).toBeCloseTo((rx / side) * 100);
  });

  it("takes its corners from the theme's --brand-badge-radius", () => {
    expect(Number.parseFloat(BADGE.radius)).toBeCloseTo(
      badgeRadiusPercent(readFileSync(THEME, "utf8"))
    );
  });

  it("places the mark the same way", () => {
    expect(svg).toContain(`transform="${BADGE.transform}"`);
  });
});
