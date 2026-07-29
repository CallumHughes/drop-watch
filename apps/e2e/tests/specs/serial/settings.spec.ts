import { ADMIN_EMAIL } from "../../../constants";
import { expect, test } from "../../fixtures";

const TEST_MAIL_SUBJECT_PATTERN = /^Test alert from /;
const HTTP_FORBIDDEN = 403;

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

test("a plain user's settings page offers only the email preference", async ({ secondUser }) => {
  await secondUser.settings.goto();

  await test.step("their own slice is there: toggle and test send", async () => {
    await expect(secondUser.settings.emailAlertsCheckbox).toBeVisible();
    await expect(secondUser.settings.sendTestButton).toBeVisible();
  });

  await test.step("none of the instance-wide plumbing is", async () => {
    await expect(secondUser.settings.cooldownInput).toBeHidden();
    await expect(secondUser.settings.failureThresholdInput).toBeHidden();
    await expect(secondUser.settings.haUrlInput).toBeHidden();
    await expect(secondUser.settings.webhookIdInput).toBeHidden();
    await expect(secondUser.settings.sendAlertsCheckbox).toBeHidden();
  });
});

test("the admin-only settings procedures refuse a plain user at the API", async ({
  secondUser,
}) => {
  // The page above merely doesn't render the form; this is the enforcement.
  // Straight to the oRPC endpoint with the second user's own cookies, the
  // way a curious user with devtools would go. Bodies are the RPC wire shape:
  // the input under a `json` key.
  const update = await secondUser.page.request.post("/api/rpc/settings/update", {
    data: { json: { cooldownMinutes: 90 } },
  });
  expect(update.status()).toBe(HTTP_FORBIDDEN);

  const get = await secondUser.page.request.post("/api/rpc/settings/get", {
    data: { json: {} },
  });
  expect(get.status()).toBe(HTTP_FORBIDDEN);
});
