import { ADMIN_EMAIL } from "../../../constants";
import { expect, test } from "../../fixtures";

const TEST_MAIL_SUBJECT_PATTERN = /^Test alert from /;

/**
 * These tests write the singleton settings row — the one piece of state every
 * other test shares (the alert sink configured by auth.setup.ts lives in it).
 * They run in the `chromium-serial` project, which starts only after the whole
 * parallel bulk has finished, so nothing is mid-flight when the row changes.
 */
test("noise controls persist across a reload", async ({ page, settings }) => {
  await test.step("change cooldown and failure threshold", async () => {
    await settings.goto();
    await settings.cooldownInput.fill("120");
    await settings.failureThresholdInput.fill("5");
    await settings.saveButton.click();
    await expect(settings.savedToast).toBeVisible();
  });

  await test.step("the saved values survive a reload", async () => {
    await page.reload();
    await expect(settings.cooldownInput).toHaveValue("120");
    await expect(settings.failureThresholdInput).toHaveValue("5");
  });
});

test("a test send reports delivery on both channels and reaches the sinks", async ({
  emailSink,
  settings,
  webhookSink,
}) => {
  await settings.goto();
  await settings.sendTestButton.click();

  await test.step("the UI reports both channels delivered", async () => {
    await expect(settings.haTestResult).toContainText("delivered");
    await expect(settings.emailTestResult).toContainText("delivered");
  });

  await test.step("the webhook sink actually received a test payload", async () => {
    const payloads = await webhookSink.payloads();
    expect(payloads.some((payload) => payload.rule === "test")).toBe(true);
  });

  await test.step("the email sink actually received the test mail", async () => {
    const mails = await emailSink.messagesWithSubject(TEST_MAIL_SUBJECT_PATTERN);
    expect(mails.some((mail) => mail.to.includes(ADMIN_EMAIL))).toBe(true);
  });
});
