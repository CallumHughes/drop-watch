import type { Locator } from "@playwright/test";

/**
 * The inline per-listing settings editor a `ListingRow` opens via `edit()`.
 * Scoped to the row's own container (not the page), since two rows can be in
 * edit mode at once and their forms would otherwise be indistinguishable.
 */
export class ListingSettingsForm {
  readonly browserRenderCheckbox: Locator;
  /** `auto` | `selector` | `regex` | `jsonpath` — how the price is found. */
  readonly extractorSelect: Locator;
  readonly saveButton: Locator;
  private readonly row: Locator;

  constructor(row: Locator) {
    this.row = row;
    this.browserRenderCheckbox = row.getByRole("checkbox", {
      name: "Load the page in a headless browser",
    });
    this.extractorSelect = row.getByLabel("How the price is found");
    this.saveButton = row.getByRole("button", { name: "Save listing settings" });
  }

  /** The expression input, whose label follows the selected mode. */
  expressionInput(mode: "CSS selector" | "Regular expression" | "JSONPath"): Locator {
    return this.row.getByLabel(`${mode} for the price`);
  }
}
