import type { Locator, Page } from "@playwright/test";

import { ListingSettingsForm } from "./listing-settings";

/**
 * One row in the product detail page's Listings card: one store's price,
 * status and controls.
 *
 * Scoped from the anchor linking to the listing's own URL rather than its
 * visible text — the row only ever shows the bare host, and two listings on
 * the same host (as every fixture-server pair is) would otherwise be
 * indistinguishable.
 */
export class ListingRow {
  readonly activeCheckbox: Locator;
  readonly checkNowButton: Locator;
  readonly confirmRemoveButton: Locator;
  readonly editButton: Locator;
  /** The formatted price span, e.g. "£90.00", or "—" before any check. */
  readonly price: Locator;
  readonly removeButton: Locator;
  /** The row's own container — everything below is scoped to it. */
  readonly row: Locator;
  /** The status badge's text — "Paused", "N failed · …", or absent when healthy. */
  readonly status: Locator;

  constructor(page: Page, listingUrl: string) {
    const anchor = page.locator(`a[href="${listingUrl}"]`);
    this.row = anchor.locator(
      'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " border-b ")][1]'
    );
    this.activeCheckbox = this.row.getByRole("checkbox", { name: "Active" });
    this.checkNowButton = this.row.getByRole("button", { name: "Check now" });
    this.editButton = this.row.getByRole("button", { exact: true, name: "Edit" });
    this.removeButton = this.row.getByRole("button", { exact: true, name: "Remove" });
    this.confirmRemoveButton = this.row.getByRole("button", { name: "Confirm remove" });
    this.price = this.row.locator(".tabular-nums");
    this.status = this.row.locator(".uppercase");
  }

  /** Queues an immediate check for this listing alone. */
  async checkNow(): Promise<void> {
    await this.checkNowButton.click();
  }

  /** Flips the Active checkbox — pauses an active listing or resumes a paused one. */
  async toggleActive(): Promise<void> {
    await this.activeCheckbox.click();
  }

  /** Opens the inline per-listing schedule/extraction form. */
  async edit(): Promise<void> {
    await this.editButton.click();
  }

  /** The settings form, once `edit()` has opened it — scoped to this row. */
  settings(): ListingSettingsForm {
    return new ListingSettingsForm(this.row);
  }

  /** Remove, through its confirm step. On the last listing this is refused server-side. */
  async remove(): Promise<void> {
    await this.removeButton.click();
    await this.confirmRemoveButton.click();
  }
}
