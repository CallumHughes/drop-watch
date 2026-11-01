import { expect, test } from "../fixtures";

const ALREADY_TRACKED_PATTERN = /already being tracked/;

test("tracks a product found by the automatic JSON-LD extraction", async ({
  addProduct,
  dashboard,
  fixtureProduct,
}) => {
  await test.step("the preview extracts title and price from the page", async () => {
    await addProduct.goto();
    await addProduct.loadPreview(fixtureProduct.url);
    await expect(addProduct.strategyNote).toContainText("schema.org JSON-LD");
  });

  await test.step("saving redirects to the product page", async () => {
    await addProduct.track();
  });

  await test.step("the product appears on the dashboard", async () => {
    await dashboard.goto();
    await expect(dashboard.productLink(fixtureProduct.title)).toBeVisible();
  });
});

test("tracks a structured-data-free page from the price it shows", async ({
  addProduct,
  fixtureProduct,
}) => {
  await fixtureProduct.publish({ price: "42.50", template: "selector" });

  await test.step("the automatic chain finds nothing and asks for the price", async () => {
    await addProduct.goto();
    await addProduct.loadPreview(fixtureProduct.url);
    await expect(addProduct.noAutoMatchNote).toBeVisible();
    await expect(addProduct.expectedPriceInput).toBeVisible();
    await expect(addProduct.trackButton).toBeDisabled();
  });

  await test.step("the displayed price is enough to find where it comes from", async () => {
    await addProduct.locatePrice("42.50");
    await expect(addProduct.trackButton).toBeEnabled();
  });

  await test.step("saving works without anyone writing an expression", async () => {
    await addProduct.track();
  });
});

test("the same URL cannot be tracked twice", async ({ addProduct, fixtureProduct }) => {
  await test.step("track it once", async () => {
    await addProduct.goto();
    await addProduct.loadPreview(fixtureProduct.url);
    await addProduct.track();
  });

  await test.step("a second attempt is rejected", async () => {
    await addProduct.goto();
    await addProduct.loadPreview(fixtureProduct.url);
    await addProduct.trackButton.click();
    await expect(addProduct.page.getByText(ALREADY_TRACKED_PATTERN)).toBeVisible();
  });
});
