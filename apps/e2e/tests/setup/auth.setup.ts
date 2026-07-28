import {
  ADMIN_EMAIL,
  ADMIN_NAME,
  ADMIN_PASSWORD,
  ADMIN_STORAGE_STATE,
  FIXTURE_URL,
  SINK_WEBHOOK_ID,
} from "../../constants";
import { expect, test } from "../fixtures";

/**
 * The storageState producer, and the one test that sees the instance before it
 * has an account.
 *
 * Global setup hands this a completely empty database, so signup is open —
 * creating the admin through the sign-up UI both covers that flow and
 * bootstraps every other test. The alert sink is configured here too, so the
 * parallel specs that read webhook payloads never have to write the singleton
 * settings row themselves.
 */
test("bootstrap: sign up the admin and point alerts at the sink", async ({
  header,
  loginPage,
  page,
  settings,
}) => {
  await test.step("a fresh instance offers signup", async () => {
    await loginPage.goto();
    await expect(loginPage.signUpSwitch).toBeVisible();
  });

  await test.step("sign up lands on the dashboard, signed in", async () => {
    await loginPage.signUp(ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.waitForURL("**/dashboard");
    await expect(header.userMenuButton).toBeVisible();
  });

  await test.step("configure the Home Assistant channel to hit the sink", async () => {
    await settings.goto();
    await settings.configureWebhook(FIXTURE_URL, SINK_WEBHOOK_ID);
    await expect(settings.savedToast).toBeVisible();
  });

  await page.context().storageState({ path: ADMIN_STORAGE_STATE });
});
