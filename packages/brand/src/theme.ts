/** The badge's side in the sidebar, which its corners are measured against. */
export const BADGE_REFERENCE_PX = 32;

const ROOT_RADIUS = /--radius:\s*(?<rem>[\d.]+)rem;/u;
const BADGE_OFFSET = /--brand-badge-radius:\s*calc\(var\(--radius\)\s*-\s*(?<px>[\d.]+)px\);/u;

/**
 * `--brand-badge-radius` as a percentage of the sidebar badge, so the favicon's
 * corners match the theme's at the size the badge is actually drawn. Assumes
 * 1rem = 16px.
 */
export function badgeRadiusPercent(themeCss: string): number {
  const rem = Number(themeCss.match(ROOT_RADIUS)?.groups?.rem);
  const offset = Number(themeCss.match(BADGE_OFFSET)?.groups?.px);
  if (!(Number.isFinite(rem) && Number.isFinite(offset))) {
    throw new Error(
      "Expected `--radius: <n>rem;` and `--brand-badge-radius: calc(var(--radius) - <n>px);` in the theme"
    );
  }
  return Number((((rem * 16 - offset) / BADGE_REFERENCE_PX) * 100).toFixed(2));
}
