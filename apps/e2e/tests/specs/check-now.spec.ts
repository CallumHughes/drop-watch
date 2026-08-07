import { expect, test } from "../fixtures";

/**
 * "Check now" is the full loop in miniature: the web app enqueues onto
 * pg-boss, the worker fetches the fixture page, extracts, commits a price
 * point, and the UI's polling picks it up.
 *
 * That last step normally takes about a second — the page polls at
 * `CHECK_REFETCH_MS` while a check it asked for is outstanding. The timeout
 * stays far above it so a slow runner cannot fail the suite over scheduling.
 */
const CHECK_TIMEOUT_MS = 45_000;

test("check now records a price point and shows it", async ({
  addProduct,
  fixtureProduct,
  productDetail,
}) => {
  await test.step("track the product", async () => {
    await addProduct.goto();
    await addProduct.loadPreview(fixtureProduct.url);
    await addProduct.track();
  });

  await test.step("queue a check and watch the result land", async () => {
    await productDetail.checkNow();
    await expect(productDetail.currentPrice).toHaveText("£100.00", {
      timeout: CHECK_TIMEOUT_MS,
    });
    await expect(productDetail.lastChecked).not.toHaveText("never");
  });
});
