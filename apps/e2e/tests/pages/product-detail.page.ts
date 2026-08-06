import type { Locator, Page } from "@playwright/test";

import { ListingRow } from "../components/listing-row";

const STORE_COUNT_PATTERN = /^\d+ stores$/;

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
  /** The header's "N stores" line — only rendered once a product has more than one. */
  readonly storeCount: Locator;
  /** The Listings card's own trigger, opening the add-store sheet. */
  readonly addStoreTrigger: Locator;
  /** The header's two-step delete trigger — not the per-listing "Remove". */
  readonly deleteProductButton: Locator;
  readonly confirmDeleteButton: Locator;
  readonly cancelDeleteButton: Locator;
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
    this.notFoundMessage = page.getByText("This product could not be loaded.");
    // The product-level button's aria-label — the visible "Check now" text is
    // shared with every per-listing row button and would be ambiguous.
    this.checkNowButton = page.getByRole("button", { name: "Check every store now" });
    this.targetPriceInput = page.getByLabel("Target price");
    this.dropPercentInput = page.getByLabel("Drop alert threshold");
    this.targetRuleCheckbox = page.getByRole("checkbox", { name: "Target" });
    this.dropRuleCheckbox = page.getByRole("checkbox", { name: "Price drop" });
    this.restockRuleCheckbox = page.getByRole("checkbox", { name: "Restock" });
    this.saveSettingsButton = page.getByRole("button", { name: "Save settings" });
    this.settingsSavedToast = page.getByText("Watch settings saved.");
    this.storeCount = page.getByText(STORE_COUNT_PATTERN);
    this.addStoreTrigger = page.getByRole("button", { exact: true, name: "Add store" });
    this.deleteProductButton = page.getByRole("button", { exact: true, name: "Delete product" });
    this.confirmDeleteButton = page.getByRole("button", { name: "Confirm delete" });
    this.cancelDeleteButton = page.getByRole("button", { exact: true, name: "Cancel" });
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

  /** Delete, through its confirm step. */
  async deleteProduct(): Promise<void> {
    await this.deleteProductButton.click();
    await this.confirmDeleteButton.click();
  }

  /**
   * Adds a second (or third…) store to the product from the detail page: opens
   * the Listings card's sheet, runs the same preview flow as the add-product
   * page, and submits. The sheet closes itself on success.
   */
  async addStore(url: string): Promise<void> {
    await this.addStoreTrigger.click();
    const dialog = this.page.getByRole("dialog");
    await dialog.getByLabel("Product URL").fill(url);
    await dialog.getByRole("button", { name: "Fetch preview" }).click();
    await dialog.getByRole("button", { exact: true, name: "Add store" }).click();
  }

  /**
   * One row of the Listings card, keyed by the listing's own URL — the row
   * only shows the bare host, which two same-host listings share.
   */
  listingRow(listingUrl: string): ListingRow {
    return new ListingRow(this.page, listingUrl);
  }
}
