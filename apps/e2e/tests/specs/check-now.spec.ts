import { expect, test } from "../fixtures";

/**
 * "Check now" is the full loop in miniature: the web app enqueues onto
 * pg-boss, the worker fetches the fixture page, extracts, commits a price
 * point, and the UI's polling picks it up. The generous assertion timeout
 * covers worker pickup plus one full 15s UI poll cycle.
 */
const CHECK_TIMEOUT_MS = 45_000;

test("check now records a price point and shows it", async ({
  addProduct,
  fixtureProduct,
  productDetail,
}) => {
  await test.step("track the product", async () => {
    await addProduct.goto();
    await addProduct.fetchPreview(fixtureProduct.url);
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
