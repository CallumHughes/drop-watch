import type { RenderMode } from "@drop-watch/api/schemas/products";

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
 *
 * `available: undefined` is the capability query still in flight, and is not
 * the same as `false`. Both disable the checkbox — starting locked and
 * unlocking a beat later is the safe direction — but only a settled `false`
 * may claim no renderer is configured, or every open of the editor would
 * flash that claim on instances that have one.
 */

export type BrowserToggleHint =
  | { kind: "none" }
  | { kind: "unavailable-off" }
  | { kind: "unavailable-on" };

export function browserToggleState({
  available,
  mode,
}: {
  available: boolean | undefined;
  mode: RenderMode;
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
  if (mode === "browser") {
    return { disabled: false, hint: { kind: "unavailable-on" } };
  }
  return { disabled: true, hint: { kind: "unavailable-off" } };
}
