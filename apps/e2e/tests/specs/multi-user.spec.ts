import { ADMIN_EMAIL } from "../../constants";
import { expect, test } from "../fixtures";

const CHECK_TIMEOUT_MS = 45_000;
const ALERT_TIMEOUT_MS = 20_000;

/**
 * Products are private per account. The main `page` is the shared admin
 * session; `secondUser` is a freshly invited non-admin in a context of its
 * own — so every test here is genuinely two people looking at the same
 * instance at once.
 */

test("a brand-new account's dashboard is empty", async ({ secondUser }) => {
  // The admin's products (this suite tracks dozens) must not leak into a
  // fresh account's list — an empty grid is the whole claim.
  await secondUser.dashboard.goto();
  await expect(secondUser.dashboard.emptyState).toBeVisible();
});

test("another user's product id is indistinguishable from a missing one", async ({
  addProduct,
  fixtureProduct,
  secondUser,
}) => {
  let productId = "";

  await test.step("the admin tracks a product", async () => {
    await addProduct.goto();
    await addProduct.loadPreview(fixtureProduct.url);
    productId = await addProduct.track();
  });

  await test.step("the second user's direct visit renders not-found", async () => {
    await secondUser.productDetail.goto(productId);
    await expect(secondUser.productDetail.notFoundMessage).toBeVisible();
  });
});

test("two accounts can track the same URL without conflict", async ({
  addProduct,
  fixtureProduct,
  secondUser,
}) => {
  await test.step("the admin tracks the URL", async () => {
    await addProduct.goto();
    await addProduct.loadPreview(fixtureProduct.url);
    await addProduct.track();
  });

  await test.step("the second user tracks the very same URL", async () => {
    // Uniqueness is per-(account, url) now: what CONFLICTs for the same
    // account (product-add.spec.ts) goes through cleanly for another.
    await secondUser.addProduct.goto();
    await secondUser.addProduct.loadPreview(fixtureProduct.url);
    await secondUser.addProduct.track();
  });
});

test("a plain user's price drop mails only them and skips the webhook", async ({
  emailSink,
  secondFixtureProduct,
  secondUser,
  webhookSink,
}) => {
  await test.step("the second user opts in to email alerts", async () => {
    await secondUser.settings.goto();
    await secondUser.settings.enableEmailAlerts();
    await expect(secondUser.settings.emailPrefsSavedToast).toBeVisible();
  });

  await test.step("track their own product and record the starting price", async () => {
    // Their own fixture page, not the shared-URL scenario above: the alert
    // must be attributable to exactly one owner for the isolation claim.
    await secondUser.addProduct.goto();
    await secondUser.addProduct.loadPreview(secondFixtureProduct.url);
    await secondUser.addProduct.track();
    await secondUser.productDetail.checkNow();
    await expect(secondUser.productDetail.currentPrice).toHaveText("£100.00", {
      timeout: CHECK_TIMEOUT_MS,
    });
  });

  await test.step("enable the price-drop rule", async () => {
    await secondUser.productDetail.dropRuleCheckbox.check();
    await secondUser.productDetail.dropPercentInput.fill("10");
    await secondUser.productDetail.saveSettingsButton.click();
    await expect(secondUser.productDetail.settingsSavedToast).toBeVisible();
  });

  await test.step("drop the price and re-check", async () => {
    await secondFixtureProduct.setPrice("50.00");
    await secondUser.productDetail.checkNow();
    await expect(secondUser.productDetail.currentPrice).toHaveText("£50.00", {
      timeout: CHECK_TIMEOUT_MS,
    });
  });

  await test.step("the drop mail went to the owner and not the admin", async () => {
    const subjectPattern = new RegExp(`^Price drop .*${secondFixtureProduct.title}`);
    const dropMail = async () => (await emailSink.messagesWithSubject(subjectPattern)).at(0);

    await expect
      .poll(async () => (await dropMail()) !== undefined, { timeout: ALERT_TIMEOUT_MS })
      .toBe(true);

    const mail = await dropMail();
    expect(mail?.to).toContain(secondUser.email);
    expect(mail?.to).not.toContain(ADMIN_EMAIL);
  });

  await test.step("the webhook stayed silent for a non-admin's product", async () => {
    // The webhook is the admin's channel. Both channels are resolved in the
    // same alerting pass, so once the mail above has been observed the
    // webhook decision has already been made — reading the sink now is not a
    // did-we-look-too-early race.
    const alerts = await webhookSink.alertsFor(secondFixtureProduct.url);
    expect(alerts.some((payload) => payload.rule === "drop_percent")).toBe(false);
  });
});
