import { ADMIN_EMAIL } from "../../constants";
import { expect, test } from "../fixtures";
import type { AlertPayload } from "../support/webhook-sink";

const CHECK_TIMEOUT_MS = 45_000;
const ALERT_TIMEOUT_MS = 20_000;

/**
 * The highest-value path in the app, end to end: track → observe a price →
 * the price drops → the next check fans one alert out to both configured
 * channels — a webhook into the (fixture) Home Assistant and a mail through
 * the (fixture) Resend API. Both sinks are shared, so everything is filtered
 * by this test's own product URL or title.
 */
test("a price drop alerts both channels with the right numbers", async ({
  addProduct,
  emailSink,
  fixtureProduct,
  productDetail,
  webhookSink,
}) => {
  await test.step("track the product and record the starting price", async () => {
    await addProduct.goto();
    await addProduct.loadPreview(fixtureProduct.url);
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

  await test.step("the same alert was emailed to the admin", async () => {
    // Every price-drop mail in the run lands in the one sink, so this test's
    // is the one naming its own product in the subject.
    const subjectPattern = new RegExp(`^Price drop .*${fixtureProduct.title}`);
    const dropMail = async () => (await emailSink.messagesWithSubject(subjectPattern)).at(0);

    await expect
      .poll(async () => (await dropMail()) !== undefined, { timeout: ALERT_TIMEOUT_MS })
      .toBe(true);

    const mail = await dropMail();
    expect(mail?.to).toContain(ADMIN_EMAIL);
    expect(mail?.subject).toContain("£50.00");
    expect(mail?.text).toContain("£100.00");
  });
});
