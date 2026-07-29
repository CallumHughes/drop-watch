import type { Locator, Page } from "@playwright/test";

const HA_RESULT_PATTERN = /Home Assistant:/;
const EMAIL_RESULT_PATTERN = /Email:/;

/**
 * /settings — two forms on one page since settings split by owner.
 *
 * The admin form edits the singleton settings row (Home Assistant webhook,
 * cooldown, failure threshold, master switch) and only mounts for admins. The
 * email-prefs form edits the signed-in account's own email toggle and carries
 * the test-send button; every account gets it. The locators are grouped
 * accordingly so specs can assert on which half of the page an account sees.
 */
export class SettingsPage {
  // The admin form — the singleton settings row, admins only.
  readonly haUrlInput: Locator;
  readonly webhookIdInput: Locator;
  readonly cooldownInput: Locator;
  readonly failureThresholdInput: Locator;
  readonly sendAlertsCheckbox: Locator;
  readonly saveButton: Locator;
  readonly savedToast: Locator;
  // The email-prefs form — the account's own row, every signed-in user.
  readonly emailAlertsCheckbox: Locator;
  readonly saveEmailPrefsButton: Locator;
  readonly emailPrefsSavedToast: Locator;
  readonly sendTestButton: Locator;
  /** The per-channel result rows the test send renders. */
  readonly haTestResult: Locator;
  readonly emailTestResult: Locator;
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
    this.haUrlInput = page.getByLabel("Home Assistant URL");
    this.webhookIdInput = page.getByLabel("Webhook id");
    this.cooldownInput = page.getByLabel("Alert cooldown (minutes)");
    this.failureThresholdInput = page.getByLabel("Failure threshold");
    this.sendAlertsCheckbox = page.getByRole("checkbox", { name: "Send alerts" });
    this.saveButton = page.getByRole("button", { name: "Save settings" });
    this.savedToast = page.getByText("Settings saved.");
    this.emailAlertsCheckbox = page.getByRole("checkbox", { name: "Email alerts" });
    this.saveEmailPrefsButton = page.getByRole("button", { name: "Save email preference" });
    this.emailPrefsSavedToast = page.getByText("Email preference saved.");
    this.sendTestButton = page.getByRole("button", { name: "Send test" });
    this.haTestResult = page.getByText(HA_RESULT_PATTERN);
    this.emailTestResult = page.getByText(EMAIL_RESULT_PATTERN);
  }

  async goto(): Promise<void> {
    await this.page.goto("/settings");
  }

  /**
   * Points the Home Assistant channel at a webhook and turns on the master
   * switch, in one save of the admin form. Saving is what makes it real — the
   * worker reads the row per check.
   */
  async configureWebhook(haUrl: string, webhookId: string): Promise<void> {
    await this.haUrlInput.fill(haUrl);
    await this.webhookIdInput.fill(webhookId);
    await this.sendAlertsCheckbox.check();
    await this.saveButton.click();
  }

  /** Ticks the account's own email toggle and saves the email-prefs form. */
  async enableEmailAlerts(): Promise<void> {
    await this.emailAlertsCheckbox.check();
    await this.saveEmailPrefsButton.click();
  }
}
