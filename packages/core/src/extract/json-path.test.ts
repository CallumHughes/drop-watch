import { describe, expect, it } from "vitest";

import { evaluateJsonPath, type ParsedJsonPath, parseJsonPath } from "./json-path";

function resolve(expression: string, value: unknown): unknown[] {
  const path = parseJsonPath(expression);
  if ("error" in path) {
    throw new Error(`expected ${expression} to parse, got: ${path.error}`);
  }
  return evaluateJsonPath(path, value);
}

function parsed(expression: string): ParsedJsonPath {
  const path = parseJsonPath(expression);
  if ("error" in path) {
    throw new Error(path.error);
  }
  return path;
}

const DOC = {
  offers: [
    { price: 10, sku: "a" },
    { price: 20, sku: "b" },
  ],
  product: { "data-id": 7, name: "Widget", price: "12.50" },
};

describe("parseJsonPath — grammar", () => {
  it("reads dot properties", () => {
    expect(parsed("$.product.name").segments).toEqual([
      { name: "product", type: "property" },
      { name: "name", type: "property" },
    ]);
  });

  it("reads bracketed properties in either quote style", () => {
    expect(parsed("$['product'][\"name\"]").segments).toEqual([
      { name: "product", type: "property" },
      { name: "name", type: "property" },
    ]);
  });

  it("reads array indexes", () => {
    expect(parsed("$.offers[1]").segments).toEqual([
      { name: "offers", type: "property" },
      { index: 1, type: "index" },
    ]);
  });

  it("reads both wildcard spellings", () => {
    expect(parsed("$.offers[*]").segments).toEqual([
      { name: "offers", type: "property" },
      { type: "wildcard" },
    ]);
    expect(parsed("$.offers.*").segments).toEqual([
      { name: "offers", type: "property" },
      { type: "wildcard" },
    ]);
  });

  it("reads recursive descent", () => {
    expect(parsed("$..price").segments).toEqual([{ name: "price", type: "descend" }]);
  });

  it("allows hyphens inside a dot-notation key", () => {
    expect(parsed("$.product.data-id").segments).toEqual([
      { name: "product", type: "property" },
      { name: "data-id", type: "property" },
    ]);
  });

  it("treats a bare $ as the whole document", () => {
    expect(parsed("$").segments).toEqual([]);
    expect(resolve("$", 12.5)).toEqual([12.5]);
  });
});

describe("parseJsonPath — errors", () => {
  it.each([
    ["", "no expression"],
    ["product.price", "must start with `$`"],
    ["$.", "must be followed by a property name"],
    ["$..", "must be followed by a property name"],
    ["$.a[", "unclosed `[`"],
    ["$['a", "unterminated '"],
    ["$.a[?(@.b>1)]", "this JSONPath understands"],
    ["$a", "unexpected `a`"],
  ])("rejects %s", (expression, reason) => {
    const path = parseJsonPath(expression);
    expect("error" in path && path.error).toContain(reason);
  });

  it("does not evaluate filter expressions rather than sandboxing them", () => {
    // The half of the grammar every other implementation runs as JavaScript.
    const path = parseJsonPath("$.offers[?(@.price > 1)]");
    expect("error" in path).toBe(true);
  });

  it("keeps a `]` inside a quoted key", () => {
    expect(parsed("$['a]b']").segments).toEqual([{ name: "a]b", type: "property" }]);
  });
});

describe("evaluateJsonPath", () => {
  it("resolves a direct path", () => {
    expect(resolve("$.product.price", DOC)).toEqual(["12.50"]);
  });

  it("resolves an index and a wildcard", () => {
    expect(resolve("$.offers[1].price", DOC)).toEqual([20]);
    expect(resolve("$.offers[*].price", DOC)).toEqual([10, 20]);
  });

  it("resolves every match of a recursive descent in document order", () => {
    expect(resolve("$..price", DOC)).toEqual([10, 20, "12.50"]);
  });

  it("resolves nothing rather than throwing on a missing key", () => {
    expect(resolve("$.nope.deeper", DOC)).toEqual([]);
    expect(resolve("$.offers[99]", DOC)).toEqual([]);
  });

  it("does not walk into inherited properties", () => {
    expect(resolve("$..toString", DOC)).toEqual([]);
  });

  it("stops at the depth cap rather than following a deep chain forever", () => {
    let deep: Record<string, unknown> = { price: 1 };
    for (let index = 0; index < 40; index += 1) {
      deep = { nested: deep };
    }
    // Bounded, so a pathological document cannot pin the event loop.
    expect(resolve("$..price", deep)).toEqual([]);
  });

  it("survives a cycle, because the depth cap bounds the walk", () => {
    const cyclic: Record<string, unknown> = { price: 5 };
    cyclic.self = cyclic;
    expect(resolve("$..price", cyclic).length).toBeGreaterThan(0);
  });
});
