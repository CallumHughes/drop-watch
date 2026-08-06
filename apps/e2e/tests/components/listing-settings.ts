import type { Locator } from "@playwright/test";

/**
 * The inline per-listing settings editor a `ListingRow` opens via `edit()`.
 * Scoped to the row's own container (not the page), since two rows can be in
 * edit mode at once and their forms would otherwise be indistinguishable.
 */
export class ListingSettingsForm {
  readonly browserRenderCheckbox: Locator;
  readonly saveButton: Locator;

  constructor(row: Locator) {
    this.browserRenderCheckbox = row.getByRole("checkbox", {
      name: "Load the page in a headless browser",
    });
    this.saveButton = row.getByRole("button", { name: "Save listing settings" });
  }
}
