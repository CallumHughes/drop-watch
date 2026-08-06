import { describe, expect, it } from "vitest";

import { extractorNote } from "./extractor-note";

describe("extractorNote", () => {
  it.each([
    {
      expected: "Will be tracked with the automatic extractor chain.",
      render: "http",
      selector: null,
    },
    {
      expected: "Will be tracked with the automatic extractor chain, loaded in a headless browser.",
      render: "browser",
      selector: null,
    },
    {
      expected: "Will be tracked with the selector .price.",
      render: "http",
      selector: ".price",
    },
    {
      expected: "Will be tracked with the selector .price, loaded in a headless browser.",
      render: "browser",
      selector: ".price",
    },
  ] as const)(
    "describes a $render preview with selector $selector",
    ({ expected, render, selector }) => {
      expect(extractorNote({ hasPrice: true, render, selector })).toBe(expected);
    }
  );

  it("does not describe a path until a price has been found", () => {
    expect(extractorNote({ hasPrice: false, render: "browser", selector: ".price" })).toBe(
      "Find a price above before saving."
    );
  });
});
