# @drop-watch/brand

The product name, the logo artwork, and the script that turns a Canva export
into both.

The three marks in `assets/` — `mark`, `wordmark-horizontal`, `wordmark-stacked`
— are canonical, and `import` is the only thing that writes them. Everything
else, the badges beside them included, is produced by `generate`: edit a mark,
re-run that one command, and every derived file follows.

## The vocabulary

Canva's filenames use the wrong words for these, which is worth knowing before
you re-export:

| Here | Canva calls it | What it is |
| --- | --- | --- |
| `mark` | "icon" | The symbol alone — the falling arrow |
| `wordmark-horizontal` | "text row" | "DropWATCH" on one line. No arrow |
| `wordmark-stacked` | "text column" | "Drop" above "WATCH". No arrow |
| `badge` | — | The mark inside a filled square. An app-icon treatment, not a logo |

## Re-exporting from Canva

Export **SVG, transparent background**, both the light and dark variants of all
three marks, into one folder. Then:

```bash
pnpm brand:import ~/Downloads/'Drop watch Logo no bg'
```

```bash
pnpm brand:generate
```

Commit everything both commands touch.

Only the **light** (black-ink) export of each pair is kept. The two exports are
not the same artwork at different colours — their viewBoxes differ by a couple
of units, so shipping both would make the logo visibly jump when the theme
changes. Instead the ink is declared once as `fill="currentColor"` on the root
element, and one file serves both themes.

The "with backgrounds" exports are not used at all: each is the same artwork
behind a plain `<rect>`, and backgrounds are better generated than shipped.

## What `import` strips, and why

A raw Canva wordmark is around 150–515 KB and is **not really vector**. The
drop shadow on "Drop" is exported as a pair of base64 PNGs — a luminance mask
and a colour fill — embedded in the SVG. The letterforms underneath are genuine
paths; the raster is only the shadow, and it is 97% of the file.

1. **The shadow goes.** `<mask>` blocks, the `<g mask="…">` wrappers and every
   `<image>`. A shadow baked into a logo does not survive arbitrary
   backgrounds or small sizes, and a CSS `drop-shadow` can always be added back.
2. **The clip-paths go.** Canva wraps each glyph run in a clipPath set to its
   own bounding box, so the clips never clip anything. Removing them is what
   lets SVGO collapse the whole group tree into a single `<path>`.
3. **SVGO runs**, then the viewBox is cropped to the artwork's measured bounds
   plus padding, and `width`/`height` are dropped so layout controls the size.

Step 2 is the one that could in principle lose artwork, so the script does not
take it on trust: it renders the file before and after at 1000px and compares
every subpixel, and refuses to write anything that moved more than 0.05%. In
practice the three marks come out at 0.0000%, 0.0035% and 0.0087% — antialiasing
along the path edges, nothing else.

Result: **517 KB → 3.7 KB**, and crisper, because the shadow was the only part
that could not scale.

## What `generate` produces

| Output | From |
| --- | --- |
| `assets/badge.svg`, `assets/icon-scheme.svg` | `mark.svg`, centred in a rounded square |
| `assets/badge-maskable.svg` | `mark.svg`, smaller and full bleed |
| `assets/wordmark-on-{light,dark}.svg` | `wordmark-horizontal.svg`, ink baked in |
| `apps/web/src/app/favicon.ico` | `badge.svg` at 16, 32 and 48 |
| `apps/web/src/app/icon.svg` | `icon-scheme.svg` |
| `apps/web/src/app/apple-icon.png` | `badge.svg`, flattened — Apple composites transparency on black |
| `apps/web/src/app/opengraph-image.png` | `wordmark-horizontal.svg` on the dark ground |
| `apps/web/public/icon-{192,512}.png` | `badge.svg` |
| `apps/web/public/icon-maskable-512.png` | `badge-maskable.svg` |
| `src/paths.generated.ts` | all three marks, for the React components |

The horizontal wordmark is the one place the generated module and the asset
disagree, and deliberately: the asset's box stops at the "p" descender, so
anything that centres it hangs the lettering high. `generate` measures the
baseline and mirrors the space below it above the caps, which is what type
itself does. Same paths, same baseline — only the top edge moves, and only for
the components. The rasters place the artwork themselves and keep the asset's
own frame.

### Why the app icons are a badge

The mark is roughly **1:2.8** — tall and narrow. Rendered bare at 16px its shaft
falls below one pixel and reads as a grey smudge, so every app icon puts it
inside a filled square instead. That keeps a solid silhouette at any size, gives
maskable icons the safe zone they need, and matches the square the sidebar
already draws around it.

`icon.svg` carries a `prefers-color-scheme` rule and inverts itself, so the
badge stays visible against both light and dark browser chrome. The raster icons
cannot do that and are always dark-on-transparent.

## Using it

```ts
import { APP_NAME, APP_DESCRIPTION, APP_TAGLINE } from "@drop-watch/brand";
```

```tsx
import { Mark, Wordmark, WordmarkStacked } from "@drop-watch/brand/components/logo";
```

The components take any `<svg>` prop and inherit their colour, so size and ink
come from the caller: `<Mark className="h-4 w-auto text-muted-foreground" />`.
They are `aria-hidden` by default, since they almost always sit beside text that
already names the product — a caller using one on its own gives the surrounding
link or heading the accessible name.
