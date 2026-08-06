import { expect, test } from "../fixtures";

/**
 * A JavaScript-built price first fails the cheap HTTP preview, then succeeds
 * through the renderer sidecar. This stays separate from product-add coverage
 * because it is the only spec that depends on the renderer web server.
 */
test("browser rendering retries a JavaScript-built price and saves that mode", async ({
  addProduct,
  fixtureProduct,
  productDetail,
}) => {
  await fixtureProduct.publish({ template: "js" });

  await test.step("the HTTP preview has no automatic match", async () => {
    await addProduct.goto();
    await addProduct.fetchPreview(fixtureProduct.url);
    await expect(addProduct.noAutoMatchNote).toBeVisible();
  });

  await test.step("retrying in a browser finds the JSON-LD price", async () => {
    await addProduct.retryWithBrowserButton.click();
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

test("changing the URL discards its preview and starts the new URL on HTTP", async ({
  addProduct,
  fixtureProduct,
  secondFixtureProduct,
}) => {
  await fixtureProduct.publish({ template: "js" });
  await secondFixtureProduct.publish({ template: "js" });

  await test.step("the first URL offers a browser retry after its HTTP preview", async () => {
    await addProduct.goto();
    await addProduct.fetchPreview(fixtureProduct.url);
    await expect(addProduct.noAutoMatchNote).toBeVisible();
    await expect(addProduct.retryWithBrowserButton).toBeVisible();
  });

  await test.step("editing the URL invalidates the stale preview and retry", async () => {
    await addProduct.urlInput.fill(secondFixtureProduct.url);
    await expect(addProduct.noAutoMatchNote).not.toBeVisible();
    await expect(addProduct.retryWithBrowserButton).not.toBeVisible();
  });

  await test.step("an explicit fetch starts the new URL with plain HTTP", async () => {
    await addProduct.fetchPreviewButton.click();
    await expect(addProduct.noAutoMatchNote).toBeVisible();
    await expect(addProduct.retryWithBrowserButton).toBeVisible();
    await expect(addProduct.browserRenderProvenance).not.toBeVisible();
  });
});
