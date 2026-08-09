import { load } from "cheerio";
import { describe, expect, it } from "vitest";

import { collectJsonDocuments, describeJsonValue } from "./json-documents";

function collect(html: string) {
  return collectJsonDocuments({ $: load(html), html });
}

describe("collectJsonDocuments", () => {
  it("reads a response body that is itself JSON", () => {
    const body = '{"price":9.99}';
    expect(collect(body)).toContainEqual({ source: "response body", value: { price: 9.99 } });
  });

  it("reads application/json scripts and names them by id", () => {
    const documents = collect(
      '<script type="application/json" id="__NEXT_DATA__">{"props":{"price":1}}</script>'
    );
    expect(documents).toEqual([
      { source: '<script id="__NEXT_DATA__">', value: { props: { price: 1 } } },
    ]);
  });

  it("reads ld+json scripts too, so a path can reach an offer directly", () => {
    const documents = collect(
      '<script type="application/ld+json">{"@type":"Product","offers":{"price":"3.00"}}</script>'
    );
    expect(documents[0]?.value).toEqual({ "@type": "Product", offers: { price: "3.00" } });
  });

  it("reads an inline window assignment", () => {
    const documents = collect(
      '<script>window.__INITIAL_STATE__ = {"product":{"price":42}};</script>'
    );
    expect(documents).toEqual([
      { source: "__INITIAL_STATE__ =", value: { product: { price: 42 } } },
    ]);
  });

  it("reads a var assignment and an array literal", () => {
    expect(collect("<script>var __NUXT__ = [1,2];</script>")[0]).toEqual({
      source: "__NUXT__ =",
      value: [1, 2],
    });
  });

  it("ignores assignment-shaped text outside a script", () => {
    const documents = collect(`<pre>window.fake = {"price":1}</pre>
      <script>window.real = {"price":9};</script>`);

    expect(documents).toEqual([{ source: "real =", value: { price: 9 } }]);
  });

  it("ignores assignments inside script comments and strings", () => {
    const documents = collect(`<script>
      // window.lineComment = {"price":1};
      const example = 'window.stringValue = {"price":2}';
      /* window.blockComment = {"price":3}; */
      window.real = {"price":9};
    </script>`);

    expect(documents).toEqual([{ source: "real =", value: { price: 9 } }]);
  });

  it("does not truncate at a brace inside a string", () => {
    // Slicing to the next `}` is the obvious implementation and the wrong one:
    // a price sits next to markup containing braces more often than not.
    const documents = collect('<script>window.state = {"label":"a } b","price":5};</script>');
    expect(documents[0]?.value).toEqual({ label: "a } b", price: 5 });
  });

  it("handles an escaped quote inside a string", () => {
    const documents = collect(
      '<script>window.state = {"label":"say \\"hi\\"","price":5};</script>'
    );
    expect(documents[0]?.value).toEqual({ label: 'say "hi"', price: 5 });
  });

  it("skips a blob that is JavaScript rather than JSON", () => {
    // Graceful degradation: this module parses, it never evaluates.
    expect(collect("<script>window.state = {price: 5, fn: function(){}};</script>")).toEqual([]);
  });

  it("skips an unterminated literal", () => {
    expect(collect('<script>window.state = {"price":5</script>')).toEqual([]);
  });

  it("ignores an assignment that is not an object or array", () => {
    expect(collect("<script>window.state = 5;</script>")).toEqual([]);
  });

  it("returns documents in the order worth trying", () => {
    const html = `<script type="application/json">{"a":1}</script>
      <script type="application/ld+json">{"b":2}</script>
      <script>window.__S__ = {"c":3};</script>`;
    expect(collect(html).map((document) => document.value)).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it("caps how many documents one page can contribute", () => {
    const scripts = Array.from(
      { length: 40 },
      (_, index) => `<script type="application/json">{"n":${index}}</script>`
    ).join("");
    expect(collect(scripts).length).toBeLessThanOrEqual(20);
  });
});

describe("describeJsonValue", () => {
  it.each([
    [12.5, "12.5"],
    ["GBP", "GBP"],
    [null, "null"],
    [{ price: 1 }, '{"price":1}'],
    [[1, 2], "[1,2]"],
  ])("renders %s for the picker", (value, expected) => {
    expect(describeJsonValue(value)).toBe(expected);
  });
});
