import { expect, test } from "../fixtures";

test("deleting a product removes it from the dashboard", async ({
  addProduct,
  dashboard,
  fixtureProduct,
  productDetail,
}) => {
  await addProduct.goto();
  await addProduct.loadPreview(fixtureProduct.url);
  const productId = await addProduct.track();

  await productDetail.deleteProduct();

  await expect(productDetail.page.getByText("Product deleted.")).toBeVisible();
  await productDetail.page.waitForURL((url) => url.pathname === "/");
  await expect(dashboard.productLink(fixtureProduct.title)).not.toBeVisible();

  // An absent card is also what a dashboard still loading looks like; the
  // detail page refusing the id is what proves the row itself is gone.
  await productDetail.goto(productId);
  await expect(productDetail.notFoundMessage).toBeVisible();
});

test("cancelling the confirm leaves the product alone", async ({
  addProduct,
  fixtureProduct,
  productDetail,
}) => {
  await addProduct.goto();
  await addProduct.loadPreview(fixtureProduct.url);
  const productId = await addProduct.track();

  await productDetail.deleteProductButton.click();
  await productDetail.cancelDeleteButton.click();

  await expect(productDetail.deleteProductButton).toBeVisible();
  await expect(productDetail.confirmDeleteButton).not.toBeVisible();
  expect(productDetail.page.url()).toContain(`/products/${productId}`);
});
