import type { Locator } from "@playwright/test";

/**
 * The inline per-listing settings editor a `ListingRow` opens via `edit()`.
 * Scoped to the row's own container (not the page), since two rows can be in
 * edit mode at once and their forms would otherwise be indistinguishable.
 */
export class ListingSettingsForm {
  readonly applyRepairButton: Locator;
  readonly browserRenderCheckbox: Locator;
  /** `auto` | `selector` | `jsonpath` — how the price is found. */
  readonly extractorSelect: Locator;
  readonly repairButton: Locator;
  readonly saveButton: Locator;
  readonly singleMatchNote: Locator;
  private readonly row: Locator;

  constructor(row: Locator) {
    this.row = row;
    this.browserRenderCheckbox = row.getByRole("checkbox", {
      name: "Load the page in a headless browser",
    });
    this.extractorSelect = row.getByLabel("How the price is found");
    this.repairButton = row.getByRole("button", { name: "Re-preview and repair" });
    this.applyRepairButton = row.getByRole("button", { name: "Apply repair" });
    this.saveButton = row.getByRole("button", { name: "Save listing settings" });
    this.singleMatchNote = row.getByText("1 match", { exact: true });
  }

  /** The expression input, whose label follows the selected mode. */
  expressionInput(mode: "CSS selector" | "JSONPath"): Locator {
    return this.row.getByLabel(`${mode} for the price`);
  }
}
