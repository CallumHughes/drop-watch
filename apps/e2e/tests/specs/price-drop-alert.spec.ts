import { expect, test } from "../fixtures";
import type { AlertPayload } from "../support/webhook-sink";

const CHECK_TIMEOUT_MS = 45_000;
const ALERT_TIMEOUT_MS = 20_000;

/**
 * The highest-value path in the app, end to end: track → observe a price →
 * the price drops → the next check fires a webhook alert into the (fixture)
 * Home Assistant. The sink is shared, so everything is filtered by this
 * test's own product URL.
 */
test("a price drop fires a webhook alert with the right numbers", async ({
  addProduct,
  fixtureProduct,
  productDetail,
  webhookSink,
}) => {
  await test.step("track the product and record the starting price", async () => {
    await addProduct.goto();
    await addProduct.fetchPreview(fixtureProduct.url);
    await addProduct.track();
    await productDetail.checkNow();
    await expect(productDetail.currentPrice).toHaveText("£100.00", {
      timeout: CHECK_TIMEOUT_MS,
    });
  });

  await test.step("enable the price-drop rule", async () => {
    await productDetail.dropRuleCheckbox.check();
    await productDetail.dropPercentInput.fill("10");
    await productDetail.saveSettingsButton.click();
    await expect(productDetail.settingsSavedToast).toBeVisible();
  });

  await test.step("drop the price and re-check", async () => {
    await fixtureProduct.setPrice("50.00");
    await productDetail.checkNow();
    await expect(productDetail.currentPrice).toHaveText("£50.00", {
      timeout: CHECK_TIMEOUT_MS,
    });
  });

  await test.step("the webhook sink received the alert", async () => {
    const dropAlert = async (): Promise<AlertPayload | undefined> => {
      const alerts = await webhookSink.alertsFor(fixtureProduct.url);
      return alerts.find((candidate) => candidate.rule === "drop_percent");
    };

    await expect
      .poll(async () => (await dropAlert()) !== undefined, { timeout: ALERT_TIMEOUT_MS })
      .toBe(true);

    const alert = await dropAlert();
    expect(alert?.price).toBe("50.00");
    expect(alert?.previousPrice).toBe("100.00");
    expect(alert?.title).toBe(fixtureProduct.title);
  });
});
