import {
  ADMIN_EMAIL,
  ADMIN_NAME,
  ADMIN_PASSWORD,
  ADMIN_STORAGE_STATE,
  FIXTURE_URL,
  SINK_WEBHOOK_ID,
} from "../../constants";
import { expect, test } from "../fixtures";

const VERIFY_SUBJECT_PATTERN = /^Verify your .* email address$/;

/**
 * The storageState producer, and the one test that sees the instance before it
 * has an account.
 *
 * Global setup hands this a completely empty database, so signup is open. The
 * suite runs the app email-enabled, which is the configuration that used to
 * strand this account: `requireEmailVerification` is on, so an unverified
 * bootstrap admin could never sign in. The admin is born verified instead —
 * asserted here by landing straight on the dashboard with no mail to open —
 * and every other test signs in as it. The alert sink and the email channel
 * are configured here too, so the parallel specs that read alert payloads
 * never have to write the singleton settings row themselves.
 */
test("bootstrap: sign up as the verified admin, point alerts at the sinks", async ({
  emailSink,
  loginPage,
  page,
  settings,
  sidebar,
}) => {
  await test.step("a fresh instance offers signup", async () => {
    await loginPage.goto();
    await expect(loginPage.signUpSwitch).toBeVisible();
  });

  await test.step("signing up lands on the dashboard, signed in", async () => {
    await loginPage.signUp(ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.waitForURL((url) => url.pathname === "/");
    await expect(sidebar.userMenuButton).toBeVisible();
  });

  await test.step("nothing was sent to verify an address already trusted", async () => {
    const mails = await emailSink.messagesWithSubject(VERIFY_SUBJECT_PATTERN);
    expect(mails.filter((mail) => mail.to.includes(ADMIN_EMAIL))).toHaveLength(0);
  });

  await test.step("configure both alert channels: sink webhook and email", async () => {
    // Two saves because the channels live in different rows now: the webhook
    // and master switch in the singleton settings row (admin form), the email
    // toggle on the admin's own user row (email-prefs form, default off).
    await settings.goto();
    await settings.configureWebhook(FIXTURE_URL, SINK_WEBHOOK_ID);
    await expect(settings.savedToast).toBeVisible();
    await settings.enableEmailAlerts();
    await expect(settings.emailPrefsSavedToast).toBeVisible();
  });

  await page.context().storageState({ path: ADMIN_STORAGE_STATE });
});
