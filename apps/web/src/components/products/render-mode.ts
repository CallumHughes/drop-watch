/**
 * Pure decision logic for the "load in a headless browser" checkbox, split
 * out of `ListingSettingsForm` because `apps/web/vitest.config.ts` only
 * collects `src/**\/*.test.ts` — a `.tsx` component is not testable here at
 * all, so anything worth covering has to live in a `.ts` module.
 *
 * Not a flat `disabled: !available`: a listing can already be `render:
 * "browser"` on an instance where `RENDER_URL` was since removed, and
 * disabling the checkbox would trap the user in a failing mode with no way
 * to untick it. Un-ticking must always stay possible.
 */

import type { Listing } from "@drop-watch/api/routers/products";

export type BrowserToggleHint =
  | { kind: "none" }
  | { kind: "unavailable-off" }
  | { kind: "unavailable-on" };

/**
 * @param available Whether a renderer is configured. `undefined` means the
 * capability query is still in flight, and is not the same as `false`. Both
 * disable the checkbox — starting locked and unlocking a beat later is the
 * safe direction — but only a settled `false` may claim no renderer is
 * configured, or every open of the editor would flash that claim on instances
 * that have one. A query that has *failed* is `false`, not `undefined`: it
 * will not answer on its own, and treating it as unknown would disable the
 * checkbox with no way back — the very trap described above. Callers must map
 * their error state.
 *
 * @param listing The saved row, taken whole rather than as a loose
 * `RenderMode`, so the draft the checkbox is currently showing cannot be
 * passed by mistake — it is the same type and would otherwise typecheck.
 * Feeding it the draft makes the escape hatch one-way: unticking would flip
 * the answer to `unavailable-off` mid-edit and grey the box out before the
 * save, so a user who changed their mind would have to close and reopen the
 * editor. The question this answers is "is this row stuck in a mode it can no
 * longer run?", which only the saved value can speak to.
 */
export function browserToggleState({
  available,
  listing,
}: {
  available: boolean | undefined;
  listing: Pick<Listing, "render">;
}): {
  disabled: boolean;
  hint: BrowserToggleHint;
} {
  if (available === undefined) {
    return { disabled: true, hint: { kind: "none" } };
  }
  if (available) {
    return { disabled: false, hint: { kind: "none" } };
  }
  if (listing.render === "browser") {
    return { disabled: false, hint: { kind: "unavailable-on" } };
  }
  return { disabled: true, hint: { kind: "unavailable-off" } };
}
