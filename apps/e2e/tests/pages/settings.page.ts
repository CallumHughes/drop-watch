import type { Locator, Page } from "@playwright/test";

const HA_RESULT_PATTERN = /Home Assistant:/;

/** /settings — instance-wide alert configuration (the singleton settings row). */
export class SettingsPage {
  readonly haUrlInput: Locator;
  readonly webhookIdInput: Locator;
  readonly cooldownInput: Locator;
  readonly failureThresholdInput: Locator;
  readonly sendAlertsCheckbox: Locator;
  readonly saveButton: Locator;
  readonly sendTestButton: Locator;
  readonly savedToast: Locator;
  /** The per-channel result row the test send renders for Home Assistant. */
  readonly haTestResult: Locator;
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
    this.haUrlInput = page.getByLabel("Home Assistant URL");
    this.webhookIdInput = page.getByLabel("Webhook id");
    this.cooldownInput = page.getByLabel("Alert cooldown (minutes)");
    this.failureThresholdInput = page.getByLabel("Failure threshold");
    this.sendAlertsCheckbox = page.getByRole("checkbox", { name: "Send alerts" });
    this.saveButton = page.getByRole("button", { name: "Save settings" });
    this.sendTestButton = page.getByRole("button", { name: "Send test" });
    this.savedToast = page.getByText("Settings saved.");
    this.haTestResult = page.getByText(HA_RESULT_PATTERN);
  }

  async goto(): Promise<void> {
    await this.page.goto("/settings");
  }

  /**
   * Points the Home Assistant channel somewhere and turns the master switch
   * on. Saving is what makes it real — the worker reads the row per check.
   */
  async configureWebhook(haUrl: string, webhookId: string): Promise<void> {
    await this.haUrlInput.fill(haUrl);
    await this.webhookIdInput.fill(webhookId);
    await this.sendAlertsCheckbox.check();
    await this.saveButton.click();
  }
}
