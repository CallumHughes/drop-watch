import {
  ADMIN_EMAIL,
  ADMIN_NAME,
  ADMIN_PASSWORD,
  ADMIN_STORAGE_STATE,
  FIXTURE_URL,
  SINK_WEBHOOK_ID,
} from "../../constants";
import { expect, test } from "../fixtures";
import { type CapturedEmail, extractAuthLink } from "../support/email-sink";

const VERIFY_SUBJECT_PATTERN = /^Verify your .* email address$/;
const EMAIL_TIMEOUT_MS = 15_000;

/**
 * The storageState producer, and the one test that sees the instance before it
 * has an account.
 *
 * Global setup hands this a completely empty database, so signup is open —
 * and because the suite runs the app email-enabled, signing up requires
 * verification: the account cannot sign in until the link from the captured
 * verification mail has been opened. Walking that whole loop here both covers
 * it and bootstraps the verified admin every other test signs in as. The alert
 * sink and the email channel are configured here too, so the parallel specs
 * that read alert payloads never have to write the singleton settings row
 * themselves.
 */
test("bootstrap: sign up, verify by email, point alerts at the sinks", async ({
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

  let verificationMail: CapturedEmail | undefined;
  await test.step("signing up sends a verification mail, not a session", async () => {
    await loginPage.signUp(ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD);
    await expect
      .poll(
        async () => {
          const mails = await emailSink.messagesWithSubject(VERIFY_SUBJECT_PATTERN);
          verificationMail = mails.find((mail) => mail.to.includes(ADMIN_EMAIL));
          return verificationMail !== undefined;
        },
        { timeout: EMAIL_TIMEOUT_MS }
      )
      .toBe(true);
  });

  await test.step("opening the link verifies the address and signs in", async () => {
    if (!verificationMail) {
      throw new Error("verification mail never captured");
    }
    await page.goto(extractAuthLink(verificationMail, "/api/auth/verify-email"));
    await page.goto("/");
    await expect(sidebar.userMenuButton).toBeVisible();
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
