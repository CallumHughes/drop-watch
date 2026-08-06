import { expect, test } from "../fixtures";
import type { AlertPayload } from "../support/webhook-sink";

/**
 * One product, two stores: the fixture server's two products stand in for two
 * retailers selling the same thing, tied together as listings on one product
 * via `productDetail.addStore`. Every price-touching wait uses the same
 * generous timeout `check-now.spec.ts` does, and for the same reason.
 */
const CHECK_TIMEOUT_MS = 45_000;
const ALERT_TIMEOUT_MS = 20_000;
const ONLY_LISTING_PATTERN = /only listing/;

test("tracking a second store surfaces two listings, a two-line chart, and the cheaper dashboard price", async ({
  addProduct,
  dashboard,
  fixtureProduct,
  productDetail,
  secondFixtureProduct,
}) => {
  await test.step("track store A and check it", async () => {
    await addProduct.goto();
    await addProduct.fetchPreview(fixtureProduct.url);
    await addProduct.track();
    await productDetail.checkNow();
    await expect(productDetail.currentPrice).toHaveText("£100.00", {
      timeout: CHECK_TIMEOUT_MS,
    });
  });

  const storeB = productDetail.listingRow(secondFixtureProduct.url);

  await test.step("add a cheaper store B and check it", async () => {
    await secondFixtureProduct.setPrice("90.00");
    await productDetail.addStore(secondFixtureProduct.url);
    await expect(productDetail.storeCount).toHaveText("2 stores");

    await storeB.checkNow();
    await expect(storeB.price).toHaveText("£90.00", { timeout: CHECK_TIMEOUT_MS });
  });

  await test.step("the chart legend names both stores", async () => {
    // Both fixture products sit on this worker's one host, so the legend has
    // to fall back to the path segment to tell them apart.
    await expect(
      productDetail.page.getByText(`${fixtureProduct.host} · ${fixtureProduct.slug}`)
    ).toBeVisible();
    await expect(
      productDetail.page.getByText(`${secondFixtureProduct.host} · ${secondFixtureProduct.slug}`)
    ).toBeVisible();
  });

  await test.step("the product's current price is the cheaper store's", async () => {
    await expect(productDetail.currentPrice).toHaveText("£90.00");
  });

  await test.step("the dashboard card shows the same cheapest price", async () => {
    await dashboard.goto();
    await expect(dashboard.productPrice(fixtureProduct.title)).toHaveText("£90.00");
  });
});

test("a target alert names the cheapest listing, and a pricier store checked after does not refire it", async ({
  addProduct,
  fixtureProduct,
  productDetail,
  secondFixtureProduct,
  webhookSink,
}) => {
  let productId = "";

  await test.step("track store A and add a cheaper store B", async () => {
    await addProduct.goto();
    await addProduct.fetchPreview(fixtureProduct.url);
    productId = await addProduct.track();

    await secondFixtureProduct.setPrice("90.00");
    await productDetail.addStore(secondFixtureProduct.url);
    await expect(productDetail.storeCount).toHaveText("2 stores");
  });

  await test.step("set a target between the two prices", async () => {
    await productDetail.targetRuleCheckbox.check();
    await productDetail.targetPriceInput.fill("95.00");
    await productDetail.saveSettingsButton.click();
    await expect(productDetail.settingsSavedToast).toBeVisible();
  });

  const storeA = productDetail.listingRow(fixtureProduct.url);
  const storeB = productDetail.listingRow(secondFixtureProduct.url);

  const targetAlerts = async (): Promise<AlertPayload[]> => {
    const alerts = await webhookSink.payloads();
    return alerts.filter((alert) => alert.productId === productId && alert.rule === "target");
  };

  await test.step("checking the cheaper store fires the target alert on its own url", async () => {
    await storeB.checkNow();
    await expect(storeB.price).toHaveText("£90.00", { timeout: CHECK_TIMEOUT_MS });

    await expect
      .poll(async () => (await targetAlerts()).length, { timeout: ALERT_TIMEOUT_MS })
      .toBe(1);

    const [alert] = await targetAlerts();
    expect(alert?.url).toBe(secondFixtureProduct.url);
    expect(alert?.listingId).toBeTruthy();
  });

  await test.step("checking the pricier store, still above target, sends no second alert", async () => {
    await storeA.checkNow();
    await expect(storeA.price).toHaveText("£100.00", { timeout: CHECK_TIMEOUT_MS });

    expect((await targetAlerts()).length).toBe(1);
  });
});

test("pausing the cheaper store falls the product's price back to the other", async ({
  addProduct,
  fixtureProduct,
  productDetail,
  secondFixtureProduct,
}) => {
  await addProduct.goto();
  await addProduct.fetchPreview(fixtureProduct.url);
  await addProduct.track();
  await productDetail.checkNow();
  await expect(productDetail.currentPrice).toHaveText("£100.00", { timeout: CHECK_TIMEOUT_MS });

  await secondFixtureProduct.setPrice("90.00");
  await productDetail.addStore(secondFixtureProduct.url);
  const storeB = productDetail.listingRow(secondFixtureProduct.url);
  await storeB.checkNow();
  await expect(storeB.price).toHaveText("£90.00", { timeout: CHECK_TIMEOUT_MS });
  await expect(productDetail.currentPrice).toHaveText("£90.00");

  await test.step("pausing store B falls the price back to store A's", async () => {
    await storeB.toggleActive();
    await expect(storeB.status).toHaveText("Paused");
    await expect(productDetail.currentPrice).toHaveText("£100.00");
  });
});

test("removing a product's only listing is refused", async ({
  addProduct,
  fixtureProduct,
  productDetail,
}) => {
  await addProduct.goto();
  await addProduct.fetchPreview(fixtureProduct.url);
  await addProduct.track();

  const onlyStore = productDetail.listingRow(fixtureProduct.url);
  await onlyStore.remove();

  await expect(productDetail.page.getByText(ONLY_LISTING_PATTERN)).toBeVisible();
  await expect(onlyStore.row).toBeVisible();
});
