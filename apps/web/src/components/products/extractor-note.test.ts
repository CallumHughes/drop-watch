import { describe, expect, it } from "vitest";

import { extractorNote } from "./extractor-note";

describe("extractorNote", () => {
  it.each([
    {
      expected: "Will be tracked with the automatic extractor chain.",
      expression: null,
      mode: null,
      render: "http",
    },
    {
      expected: "Will be tracked with the automatic extractor chain, loaded in a headless browser.",
      expression: null,
      mode: null,
      render: "browser",
    },
    {
      expected: "Will be tracked with the selector .price.",
      expression: ".price",
      mode: "selector",
      render: "http",
    },
    {
      expected: "Will be tracked with the selector .price, loaded in a headless browser.",
      expression: ".price",
      mode: "selector",
      render: "browser",
    },
    {
      expected: 'Will be tracked with the regular expression data-price="([0-9.]+)".',
      expression: 'data-price="([0-9.]+)"',
      mode: "regex",
      render: "http",
    },
    {
      expected: "Will be tracked with the JSONPath $..price.",
      expression: "$..price",
      mode: "jsonpath",
      render: "http",
    },
  ] as const)(
    "describes a $render preview in $mode mode",
    ({ expected, expression, mode, render }) => {
      expect(extractorNote({ expression, hasPrice: true, mode, render })).toBe(expected);
    }
  );

  it("does not describe a path until a price has been found", () => {
    expect(
      extractorNote({
        expression: ".price",
        hasPrice: false,
        mode: "selector",
        render: "browser",
      })
    ).toBe("Find a price above before saving.");
  });
});
