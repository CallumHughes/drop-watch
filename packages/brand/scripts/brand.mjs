#!/usr/bin/env node
/**
 * The Canva round-trip.
 *
 * `import <dir>` turns a raw Canva export into the clean, canonical SVGs in
 * `assets/`. `generate` renders every raster the apps consume from those SVGs.
 * The assets are canonical: every PNG, ICO and generated module in the repo is
 * derived from them, so a tweak means re-exporting and re-running these two
 * commands rather than hand-editing anything downstream.
 *
 * See README.md for what each step strips and why.
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { optimize } from "svgo";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(PKG, "../..");
const ASSETS = join(PKG, "assets");

/** Near-black, matching `--foreground` / dark `--background` (oklch(0.145 0 0)). */
const INK = "#0a0a0a";
const PAPER = "#ffffff";

/** A rendering difference above this fraction of subpixels fails the import. */
const DIFF_BUDGET = 0.0005;

const MARKS = [
  { pad: 0.04, slug: "mark", token: "icon" },
  { pad: 0.02, slug: "wordmark-horizontal", token: "row" },
  { pad: 0.02, slug: "wordmark-stacked", token: "column" },
];

const MASK_BLOCK = /<mask\b[\s\S]*?<\/mask>/g;
const MASK_GROUP = /<g\s+mask="url\(#[^)]+\)"\s*>/;
const GROUP_TAG = /<\/?g[\s>]/;
const IMAGE_TAG = /<image\b[^>]*\/>/g;
const CLIP_ATTR = /\s+clip-path="url\(#[^)]+\)"/g;
const CLIP_BLOCK = /<clipPath\b[\s\S]*?<\/clipPath>/g;
const VIEW_BOX = /viewBox="([-\d.\s]+)"/;
const SVG_OPEN = /^[\s\S]*?<svg[^>]*>/;
const SVG_CLOSE = /<\/svg>\s*$/;
const MONOCHROME_FILL = /\s+fill="(?:#000000|#000|#ffffff|#fff)"/g;
const ANY_FILL = /\s+fill="[^"]*"/g;
const PATH_DATA = /<path[^>]*\sd="([^"]+)"/g;
const WHITESPACE = /\s+/;

// --- SVG surgery ---------------------------------------------------------

/** Removes `<g>` subtrees whose opening tag matches, counting nesting. */
function dropGroups(source, opening) {
  let out = source;
  for (;;) {
    const found = out.match(opening);
    if (!found) {
      return out;
    }
    const start = found.index;
    let depth = 0;
    let at = start;
    for (;;) {
      const next = out.slice(at).search(GROUP_TAG);
      if (next === -1) {
        return out;
      }
      const tag = at + next;
      const after = out.indexOf(">", tag) + 1;
      if (out[tag + 1] === "/") {
        depth -= 1;
        at = after;
        if (depth === 0) {
          out = out.slice(0, start) + out.slice(at);
          break;
        }
      } else {
        depth += 1;
        at = after;
      }
    }
  }
}

/**
 * Canva renders a text effect — here the drop shadow on "Drop" — as a pair of
 * base64 PNGs used as a luminance mask. That raster is 97% of the file and the
 * only part of it that is not vector; the letterforms beneath are real paths.
 */
function stripShadow(svg) {
  return dropGroups(svg.replace(MASK_BLOCK, ""), MASK_GROUP).replace(IMAGE_TAG, "");
}

/**
 * Canva wraps every glyph run in a clipPath set to its own bounding box, so the
 * clips never actually clip. Dropping them is what lets SVGO collapse the group
 * tree into a single path — and the render diff below is what proves it.
 */
function stripClips(svg) {
  return svg.replace(CLIP_ATTR, "").replace(CLIP_BLOCK, "");
}

function minify(svg) {
  return optimize(svg, {
    floatPrecision: 2,
    multipass: true,
    plugins: [
      { name: "preset-default", params: { overrides: { cleanupIds: false } } },
      "removeDimensions",
    ],
  }).data;
}

function viewBox(svg) {
  const found = svg.match(VIEW_BOX);
  if (!found) {
    throw new Error("no viewBox");
  }
  return found[1].trim().split(WHITESPACE).map(Number);
}

const inner = (svg) => svg.replace(SVG_OPEN, "").replace(SVG_CLOSE, "");
const paintable = (svg) => svg.replaceAll("currentColor", INK);
const round = (n) => Number(n.toFixed(2));

// --- measurement ---------------------------------------------------------

function raster(svg, width, height) {
  return sharp(Buffer.from(paintable(svg)))
    .resize(width, height, { fit: "fill" })
    .raw()
    .toBuffer();
}

/** The fraction of subpixels that differ visibly between two renderings. */
async function drift(before, after) {
  const [, , w, h] = viewBox(before);
  const width = 1000;
  const height = Math.round((h / w) * width);
  const [a, b] = await Promise.all([raster(before, width, height), raster(after, width, height)]);
  let differing = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (Math.abs(a[i] - b[i]) > 8) {
      differing += 1;
    }
  }
  return differing / a.length;
}

/** The artwork's true bounds in user units, found by trimming a 4x rendering. */
async function inkBox(svg) {
  const [minX, minY, w, h] = viewBox(svg);
  const scale = 4;
  const probe = await sharp(Buffer.from(paintable(svg)))
    .resize(Math.round(w * scale), Math.round(h * scale), { fit: "fill" })
    .png()
    .toBuffer();
  const { info } = await sharp(probe).trim({ threshold: 1 }).toBuffer({ resolveWithObject: true });
  return {
    h: info.height / scale,
    w: info.width / scale,
    x: minX + Math.abs(info.trimOffsetLeft) / scale,
    y: minY + Math.abs(info.trimOffsetTop) / scale,
  };
}

/** Reframes to the artwork's own bounds plus padding, so layout controls size. */
function crop(svg, box, pad) {
  const inset = Math.max(box.w, box.h) * pad;
  const next = [
    round(box.x - inset),
    round(box.y - inset),
    round(box.w + inset * 2),
    round(box.h + inset * 2),
  ];
  return svg.replace(VIEW_BOX, `viewBox="${next.join(" ")}"`);
}

/**
 * An .ico wrapping PNGs: a 6-byte header, one 16-byte directory entry each,
 * then the images. Hand-rolled because the obvious package declares
 * `@types/node` as a runtime dependency, which drags a second major of the
 * Node types through every peer context in the lockfile.
 */
function icoFrom(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);

  let offset = header.length + pngs.length * 16;
  const entries = pngs.map(({ data, size }) => {
    const entry = Buffer.alloc(16);
    // 0 means 256 in this field; nothing here is that large, but the encoding
    // is the format's, not ours.
    entry.writeUInt8(size % 256, 0);
    entry.writeUInt8(size % 256, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...pngs.map(({ data }) => data)]);
}

// --- badges --------------------------------------------------------------

/**
 * The mark is 1:2.8, so bare at 16px its shaft falls under a pixel and reads as
 * a smudge. Every app icon therefore sits in a filled square, which also gives
 * maskable icons the safe zone they need.
 */
function badge({ art, box, fraction, radius, scheme }) {
  const side = 100;
  const scale = (side * fraction) / box.h;
  const x = side / 2 - (box.x + box.w / 2) * scale;
  const y = side / 2 - (box.y + box.h / 2) * scale;
  const flip = scheme
    ? `@media(prefers-color-scheme:dark){.bg{fill:${PAPER}}.fg{fill:${INK}}}`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}"><style>.bg{fill:${INK}}.fg{fill:${PAPER}}${flip}</style><rect class="bg" width="${side}" height="${side}"${radius ? ` rx="${radius}"` : ""}/><g class="fg" transform="translate(${round(x)} ${round(y)}) scale(${scale.toFixed(6)})">${art.replaceAll(ANY_FILL, "")}</g></svg>\n`;
}

// --- import --------------------------------------------------------------

async function clean(dir, files, { pad, slug, token }) {
  // Only the light-ink export is kept: the pair's geometry differs by a few
  // units, so shipping both would make a theme swap visibly shift the logo.
  const name = files.find((f) => {
    const lower = f.toLowerCase();
    return lower.includes(token) && lower.includes("light");
  });
  if (!name) {
    throw new Error(`no "${token} light" SVG in ${dir}`);
  }

  const raw = await readFile(join(dir, name), "utf8");
  const shadowless = stripShadow(raw);
  const flat = minify(stripClips(shadowless));

  const moved = await drift(shadowless, flat);
  if (moved > DIFF_BUDGET) {
    throw new Error(
      `${name}: cleaning moved ${(moved * 100).toFixed(3)}% of subpixels — refusing to write`
    );
  }

  const box = await inkBox(flat);
  // SVGO drops `fill="#000"` because black is the SVG default, so the ink is
  // declared once on the root and every path inherits it. That one attribute is
  // what lets a single file serve both themes.
  const cropped = crop(flat, box, pad)
    .replaceAll(MONOCHROME_FILL, "")
    .replace("<svg ", '<svg fill="currentColor" ');

  await writeFile(join(ASSETS, `${slug}.svg`), `${cropped}\n`);
  return {
    art: inner(flat),
    box,
    line: `${slug}.svg  ${raw.length} -> ${cropped.length} bytes (-${((1 - cropped.length / raw.length) * 100).toFixed(1)}%)  drift ${(moved * 100).toFixed(4)}%`,
    slug,
  };
}

async function runImport(dir) {
  if (!dir) {
    throw new Error("usage: brand.mjs import <canva-export-dir>");
  }
  const files = (await readdir(dir)).filter((f) => f.toLowerCase().endsWith(".svg"));
  await mkdir(ASSETS, { recursive: true });

  const done = await Promise.all(MARKS.map((target) => clean(dir, files, target)));
  for (const { line } of done) {
    console.log(line);
  }

  const mark = done.find((d) => d.slug === "mark");
  await Promise.all([
    writeFile(
      join(ASSETS, "badge.svg"),
      badge({ art: mark.art, box: mark.box, fraction: 0.58, radius: 22, scheme: false })
    ),
    writeFile(
      join(ASSETS, "icon-scheme.svg"),
      badge({ art: mark.art, box: mark.box, fraction: 0.58, radius: 22, scheme: true })
    ),
    // Maskable icons are cropped to the launcher's own shape, so this one runs
    // full bleed and keeps the mark well inside the safe zone.
    writeFile(
      join(ASSETS, "badge-maskable.svg"),
      badge({ art: mark.art, box: mark.box, fraction: 0.42, radius: 0, scheme: false })
    ),
  ]);
  console.log("badge.svg, icon-scheme.svg, badge-maskable.svg");
}

// --- generate ------------------------------------------------------------

const png = (svg, width, height) =>
  sharp(Buffer.from(paintable(svg)), { density: 384 })
    .resize(width, height, { background: { alpha: 0, b: 0, g: 0, r: 0 }, fit: "contain" })
    .png();

async function emit(target, buffer) {
  const path = join(REPO, target);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buffer);
  return `${target}  ${buffer.length} bytes`;
}

function module_(name, lines) {
  return writeFile(
    join(PKG, "src", name),
    ["// Generated by scripts/brand.mjs from assets — do not edit by hand.", "", ...lines, ""].join(
      "\n"
    )
  );
}

async function runGenerate() {
  const read = (slug) => readFile(join(ASSETS, `${slug}.svg`), "utf8");
  const slugs = [
    "mark",
    "wordmark-horizontal",
    "wordmark-stacked",
    "badge",
    "badge-maskable",
    "icon-scheme",
  ];
  const [markSvg, horizontal, stacked, badgeSvg, maskable, scheme] = await Promise.all(
    slugs.map(read)
  );
  const square = (svg, size) => png(svg, size, size).toBuffer();

  // favicon.ico carries the legacy sizes; icon.svg covers everything modern and
  // flips its own colours with prefers-color-scheme.
  const [ico, apple, i192, i512, maskablePng] = await Promise.all([
    Promise.all(
      [16, 32, 48].map(async (size) => ({ data: await square(badgeSvg, size), size }))
    ).then(icoFrom),
    // Apple refuses transparency and composites on black, so flatten first.
    square(badgeSvg, 180).then((b) => sharp(b).flatten({ background: INK }).png().toBuffer()),
    square(badgeSvg, 192),
    square(badgeSvg, 512),
    square(maskable, 512),
  ]);

  // Social cards sit on their own canvas, so the wordmark gets the dark ground.
  const [, , vw, vh] = viewBox(horizontal);
  const plate = 760;
  const wordmark = await sharp(Buffer.from(horizontal.replaceAll("currentColor", PAPER)), {
    density: 384,
  })
    .resize(plate, Math.round((vh / vw) * plate), { fit: "fill" })
    .png()
    .toBuffer();
  const og = await sharp({ create: { background: INK, channels: 4, height: 630, width: 1200 } })
    .composite([{ input: wordmark }])
    .png()
    .toBuffer();

  // An <img> cannot inherit currentColor, so Markdown and anything else that
  // embeds the file rather than inlining it needs the ink baked in.
  const baked = [
    ["wordmark-on-light.svg", INK],
    ["wordmark-on-dark.svg", PAPER],
  ].map(([name, fill]) =>
    writeFile(join(ASSETS, name), horizontal.replaceAll("currentColor", fill))
  );

  const written = await Promise.all([
    emit("apps/web/src/app/favicon.ico", ico),
    emit("apps/web/src/app/icon.svg", Buffer.from(scheme)),
    emit("apps/web/src/app/apple-icon.png", apple),
    emit("apps/web/src/app/opengraph-image.png", og),
    emit("apps/web/public/icon-192.png", i192),
    emit("apps/web/public/icon-512.png", i512),
    emit("apps/web/public/icon-maskable-512.png", maskablePng),
  ]);
  await Promise.all(baked);
  for (const line of written) {
    console.log(line);
  }
  console.log("assets/wordmark-on-light.svg, assets/wordmark-on-dark.svg");

  const art = (svg) => ({
    paths: [...inner(svg).matchAll(PATH_DATA)].map((m) => m[1]),
    viewBox: viewBox(svg).join(" "),
  });
  const entry = (name, value) =>
    `export const ${name} = {\n  paths: [\n${value.paths.map((d) => `    "${d}",`).join("\n")}\n  ],\n  viewBox: "${value.viewBox}",\n} as const;`;

  await module_("paths.generated.ts", [
    entry("MARK", art(markSvg)),
    "",
    entry("WORDMARK_HORIZONTAL", art(horizontal)),
    "",
    entry("WORDMARK_STACKED", art(stacked)),
  ]);
  console.log("src/paths.generated.ts");
}

const [command, argument] = process.argv.slice(2);
if (command === "import") {
  await runImport(argument);
} else if (command === "generate") {
  await runGenerate();
} else {
  console.error("usage: brand.mjs import <canva-export-dir> | generate");
  process.exit(1);
}
