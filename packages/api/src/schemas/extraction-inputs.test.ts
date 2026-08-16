import { describe, expect, it } from "vitest";

import { listingCreateInput } from "./listings";
import { productCreateInput } from "./products";

const ATTRIBUTE_EXPRESSION = "  [data-price]::attr(data-price)  ";

describe("extraction input schemas", () => {
  it("accept whitespace-wrapped selector attribute expressions on create", () => {
    expect(
      productCreateInput.safeParse({
        expression: ATTRIBUTE_EXPRESSION,
        extractor: "selector",
        url: "https://example.test/product",
      }).success
    ).toBe(true);

    expect(
      listingCreateInput.safeParse({
        expression: ATTRIBUTE_EXPRESSION,
        extractor: "selector",
        productId: "00000000-0000-4000-8000-000000000001",
        url: "https://example.test/product",
      }).success
    ).toBe(true);
  });
});
