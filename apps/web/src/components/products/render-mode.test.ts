import { describe, expect, it } from "vitest";

import { browserToggleState } from "./render-mode";

describe("browserToggleState", () => {
  it("disables the checkbox without claiming a reason while availability is unknown", () => {
    expect(browserToggleState({ available: undefined, listing: { render: "http" } })).toEqual({
      disabled: true,
      hint: { kind: "none" },
    });
  });

  it("enables the checkbox, unticked, when a renderer is available", () => {
    expect(browserToggleState({ available: true, listing: { render: "http" } })).toEqual({
      disabled: false,
      hint: { kind: "none" },
    });
  });

  it("enables the checkbox, ticked, when a renderer is available", () => {
    expect(browserToggleState({ available: true, listing: { render: "browser" } })).toEqual({
      disabled: false,
      hint: { kind: "none" },
    });
  });

  it("disables the checkbox when no renderer is configured and the listing is not using one", () => {
    expect(browserToggleState({ available: false, listing: { render: "http" } })).toEqual({
      disabled: true,
      hint: { kind: "unavailable-off" },
    });
  });

  it("keeps the checkbox enabled so it can be unticked when a listing is already stuck on browser mode with no renderer", () => {
    expect(browserToggleState({ available: false, listing: { render: "browser" } })).toEqual({
      disabled: false,
      hint: { kind: "unavailable-on" },
    });
  });
});
