import { expect, test } from "../fixtures";

const CHECK_TIMEOUT_MS = 45_000;

/**
 * The counterpart to `ambiguous-variant-price`: the recording gate must refuse
 * pages that offer several prices without refusing pages that offer one.
 *
 * An OpenGraph page is the sharpest case, because the extractor rates every
 * OpenGraph result low confidence — the tags corroborate nothing — even though
 * a single `product:price:amount` is as unambiguous as a price gets. Gating on
 * confidence rather than ambiguity froze these listings: no price point, an
 * `extract_failed` every check, and eventually a watch-broken alarm.
 */
test("a single OpenGraph price is tracked even though it is never high confidence", async ({
  addProduct,
  fixtureProduct,
  productDetail,
}) => {
  await fixtureProduct.publish({ price: "129.00", template: "opengraph-only" });

  await test.step("the automatic preview is offered rather than blocked", async () => {
    await addProduct.goto();
    await addProduct.loadPreview(fixtureProduct.url);

    await expect(addProduct.strategyNote).toContainText("OpenGraph");
    await expect(addProduct.automaticRepairWarning).not.toBeVisible();
    await expect(addProduct.trackButton).toBeEnabled();
  });

  await test.step("a check records the price instead of failing to extract", async () => {
    await addProduct.track();
    await productDetail.checkNow();

    await expect(productDetail.currentPrice).toHaveText("£129.00", {
      timeout: CHECK_TIMEOUT_MS,
    });
  });

  await test.step("a later price change is picked up on the same automatic path", async () => {
    await fixtureProduct.setPrice("115.50");
    await productDetail.checkNow();

    await expect(productDetail.currentPrice).toHaveText("£115.50", {
      timeout: CHECK_TIMEOUT_MS,
    });
  });
});
