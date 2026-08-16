import { expect, test } from "../fixtures";

const CHECK_TIMEOUT_MS = 45_000;

/**
 * Two pages that must fall through the automatic chain: one whose price only
 * exists in an attribute value, and one whose price only exists in an embedded
 * JSON payload. The picker rescues both.
 */

test("tracks an attribute-only price with a selector attribute", async ({
  addProduct,
  fixtureProduct,
  productDetail,
}) => {
  await fixtureProduct.publish({ price: "42.50", template: "attribute-only" });

  await test.step("the automatic chain finds nothing and offers the picker", async () => {
    await addProduct.goto();
    await addProduct.loadPreview(fixtureProduct.url);
    await expect(addProduct.noAutoMatchNote).toBeVisible();
  });

  await test.step("the selector attribute syntax reads the currency-bearing value", async () => {
    await addProduct.selectorInput.fill("[data-price]::attr(data-price)");
    await expect(addProduct.strategyNote).toContainText("CSS selector");
  });

  await test.step("the worker reuses the saved selector and records its price", async () => {
    await addProduct.track();
    await productDetail.checkNow();
    await expect(productDetail.currentPrice).toHaveText("£42.50", {
      timeout: CHECK_TIMEOUT_MS,
    });
    await expect(productDetail.lastChecked).not.toHaveText("never");
  });
});

test("tracks a price that only exists in embedded JSON with a JSONPath", async ({
  addProduct,
  dashboard,
  fixtureProduct,
}) => {
  await fixtureProduct.publish({ price: "18.99", template: "json-blob" });

  await test.step("the automatic chain finds nothing and offers the picker", async () => {
    await addProduct.goto();
    await addProduct.loadPreview(fixtureProduct.url);
    await expect(addProduct.noAutoMatchNote).toBeVisible();
  });

  await test.step("a JSONPath resolves it out of the payload", async () => {
    await addProduct.mode("JSONPath").click();
    await addProduct.jsonPathInput.fill("$..price");
    await expect(addProduct.strategyNote).toContainText("JSONPath");
  });

  await test.step("saving works from the JSONPath path", async () => {
    await addProduct.track();
    await dashboard.goto();
    await expect(dashboard.productLink(fixtureProduct.title)).toBeVisible();
  });
});
