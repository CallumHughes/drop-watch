import { expect, test } from "../fixtures";

/**
 * The "load in a headless browser" toggle on a listing's settings editor.
 * Persistence only — actual browser rendering is exercised separately in
 * `browser-render.spec.ts` against the renderer Playwright starts for the
 * suite.
 */
test("the browser-render toggle survives a save and a reload", async ({
  addProduct,
  fixtureProduct,
  productDetail,
}) => {
  await addProduct.goto();
  await addProduct.fetchPreview(fixtureProduct.url);
  await addProduct.track();

  const listing = productDetail.listingRow(fixtureProduct.url);

  await test.step("tick the box and save", async () => {
    await listing.edit();
    const settings = listing.settings();
    await expect(settings.browserRenderCheckbox).toBeEnabled();
    await expect(settings.browserRenderCheckbox).not.toBeChecked();

    await settings.browserRenderCheckbox.check();
    await settings.saveButton.click();
    await expect(productDetail.page.getByText("Listing settings saved.")).toBeVisible();
  });

  await test.step("it is still ticked after a reload", async () => {
    await productDetail.page.reload();
    await listing.edit();
    await expect(listing.settings().browserRenderCheckbox).toBeChecked();
  });
});
