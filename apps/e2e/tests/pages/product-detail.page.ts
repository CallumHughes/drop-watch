import type { Locator, Page } from "@playwright/test";

/** /products/[id] — stats, history, check log and the watch settings form. */
export class ProductDetailPage {
  readonly checkNowButton: Locator;
  readonly targetPriceInput: Locator;
  readonly dropPercentInput: Locator;
  readonly targetRuleCheckbox: Locator;
  readonly dropRuleCheckbox: Locator;
  readonly restockRuleCheckbox: Locator;
  readonly saveSettingsButton: Locator;
  readonly settingsSavedToast: Locator;
  /**
   * What the page shows for an id that does not resolve — which since
   * per-user scoping includes ids that exist but belong to someone else
   * (deliberately indistinguishable from "gone").
   */
  readonly notFoundMessage: Locator;
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
    this.notFoundMessage = page.getByText("This product could not be loaded.");
    this.checkNowButton = page.getByRole("button", { name: "Check now" });
    this.targetPriceInput = page.getByLabel("Target price");
    this.dropPercentInput = page.getByLabel("Drop alert threshold");
    this.targetRuleCheckbox = page.getByRole("checkbox", { name: "Target" });
    this.dropRuleCheckbox = page.getByRole("checkbox", { name: "Price drop" });
    this.restockRuleCheckbox = page.getByRole("checkbox", { name: "Restock" });
    this.saveSettingsButton = page.getByRole("button", { name: "Save settings" });
    this.settingsSavedToast = page.getByText("Watch settings saved.");
  }

  async goto(productId: string): Promise<void> {
    await this.page.goto(`/products/${productId}`);
  }

  /** The value beneath one stat label ("Current price", "Last checked", …). */
  stat(label: string): Locator {
    return this.page.getByText(label, { exact: true }).locator("xpath=following-sibling::div[1]");
  }

  get currentPrice(): Locator {
    return this.stat("Current price");
  }

  get lastChecked(): Locator {
    return this.stat("Last checked");
  }

  /** Queues an immediate check via the UI button. */
  async checkNow(): Promise<void> {
    await this.checkNowButton.click();
  }
}
