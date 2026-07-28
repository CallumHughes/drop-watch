import { expect, test } from "../../fixtures";

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

test("a test send reports delivery and reaches the sink", async ({ settings, webhookSink }) => {
  await settings.goto();
  await settings.sendTestButton.click();

  await test.step("the UI reports the Home Assistant channel delivered", async () => {
    await expect(settings.haTestResult).toContainText("delivered");
  });

  await test.step("the sink actually received a test payload", async () => {
    const payloads = await webhookSink.payloads();
    expect(payloads.some((payload) => payload.rule === "test")).toBe(true);
  });
});
