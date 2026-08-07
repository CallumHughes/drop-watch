import { expect, test } from "../fixtures";

/**
 * A JavaScript-built price succeeds through the renderer sidecar first. This
 * stays separate from product-add coverage because it is the only spec that
 * depends on the renderer web server.
 */
test("browser-first preview finds a JavaScript-built price and saves that mode", async ({
  addProduct,
  fixtureProduct,
  productDetail,
}) => {
  await fixtureProduct.publish({ template: "js" });

  await test.step("the automatic preview finds the price in a browser", async () => {
    await addProduct.goto();
    await addProduct.loadPreview(fixtureProduct.url);
    await expect(addProduct.strategyNote).toContainText("schema.org JSON-LD");
    await expect(addProduct.browserRenderProvenance).toBeVisible();
  });

  await test.step("tracking saves the render mode that produced the preview", async () => {
    await addProduct.track();

    const listing = productDetail.listingRow(fixtureProduct.url);
    await listing.edit();
    await expect(listing.settings().browserRenderCheckbox).toBeChecked();
  });
});

test("browser no-match falls back to HTTP and saves HTTP mode", async ({
  addProduct,
  fixtureProduct,
  productDetail,
}) => {
  await fixtureProduct.publish({ template: "browser-no-match" });

  await test.step("the automatic preview falls back to the HTTP document", async () => {
    await addProduct.goto();
    await addProduct.loadPreview(fixtureProduct.url);
    await expect(addProduct.strategyNote).toContainText("schema.org JSON-LD");
    await expect(addProduct.browserRenderProvenance).not.toBeVisible();
  });

  await test.step("tracking saves the HTTP mode that produced the preview", async () => {
    await addProduct.track();

    const listing = productDetail.listingRow(fixtureProduct.url);
    await listing.edit();
    await expect(listing.settings().browserRenderCheckbox).not.toBeChecked();
  });
});

test("changing the URL discards its preview before loading the next URL", async ({
  addProduct,
  fixtureProduct,
  secondFixtureProduct,
}) => {
  await fixtureProduct.publish({ template: "js" });
  await secondFixtureProduct.publish({ template: "js" });

  await test.step("the first URL is previewed in a browser", async () => {
    await addProduct.goto();
    await addProduct.loadPreview(fixtureProduct.url);
    await expect(addProduct.browserRenderProvenance).toBeVisible();
  });

  await test.step("editing the URL invalidates the stale preview", async () => {
    await addProduct.urlInput.fill(secondFixtureProduct.url);
    await expect(addProduct.browserRenderProvenance).not.toBeVisible();
  });

  await test.step("loading the new URL also prefers the browser", async () => {
    await addProduct.loadPreviewButton.click();
    await expect(addProduct.strategyNote).toContainText("schema.org JSON-LD");
    await expect(addProduct.browserRenderProvenance).toBeVisible();
  });
});
