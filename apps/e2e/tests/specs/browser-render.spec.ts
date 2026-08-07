import { expect, test } from "../fixtures";

test("confident HTTP preview skips browser rendering and saves HTTP mode", async ({
  addProduct,
  fixtureProduct,
  productDetail,
}) => {
  await test.step("the automatic preview uses the exact HTTP result", async () => {
    await addProduct.goto();
    await addProduct.loadPreview(fixtureProduct.url);
    await expect(addProduct.page.getByText("£100.00", { exact: true })).toBeVisible();
    await expect(addProduct.browserRenderProvenance).not.toBeVisible();
  });

  await test.step("tracking saves HTTP mode", async () => {
    await addProduct.track();

    const listing = productDetail.listingRow(fixtureProduct.url);
    await listing.edit();
    await expect(listing.settings().browserRenderCheckbox).not.toBeChecked();
  });
});

test("missing HTTP price renders JavaScript and saves browser mode", async ({
  addProduct,
  fixtureProduct,
  productDetail,
}) => {
  await fixtureProduct.publish({ template: "js" });

  await test.step("the automatic preview finds the price in a browser", async () => {
    await addProduct.goto();
    await addProduct.loadPreview(fixtureProduct.url);
    await expect(addProduct.page.getByText("£100.00", { exact: true })).toBeVisible();
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

test("rendered selected SKU resolves ambiguous HTTP and saves browser mode", async ({
  addProduct,
  fixtureProduct,
  productDetail,
}) => {
  await fixtureProduct.publish({ template: "rendered-selected-sku" });

  await test.step("the rendered selection chooses the blue variant", async () => {
    await addProduct.goto();
    await addProduct.loadPreview(fixtureProduct.url);
    await expect(addProduct.page.getByText("£75.00", { exact: true })).toBeVisible();
    await expect(addProduct.browserRenderProvenance).toBeVisible();
  });

  await test.step("tracking saves browser mode", async () => {
    await addProduct.track();

    const listing = productDetail.listingRow(fixtureProduct.url);
    await listing.edit();
    await expect(listing.settings().browserRenderCheckbox).toBeChecked();
  });
});

test("browser no-match salvages ambiguous HTTP and saves HTTP mode", async ({
  addProduct,
  fixtureProduct,
  productDetail,
}) => {
  await fixtureProduct.publish({ template: "browser-no-match" });

  await test.step("the automatic preview falls back to the HTTP document", async () => {
    await addProduct.goto();
    await addProduct.loadPreview(fixtureProduct.url);
    await expect(addProduct.page.getByText("£100.00", { exact: true })).toBeVisible();
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

  await test.step("the first URL is previewed", async () => {
    await addProduct.goto();
    await addProduct.loadPreview(fixtureProduct.url);
    await expect(addProduct.browserRenderProvenance).toBeVisible();
  });

  await test.step("editing the URL invalidates the stale preview", async () => {
    await addProduct.urlInput.fill(secondFixtureProduct.url);
    await expect(addProduct.browserRenderProvenance).not.toBeVisible();
  });

  await test.step("loading the new URL creates a fresh browser preview", async () => {
    await addProduct.loadPreviewButton.click();
    await expect(addProduct.strategyNote).toContainText("schema.org JSON-LD");
    await expect(addProduct.browserRenderProvenance).toBeVisible();
  });
});
