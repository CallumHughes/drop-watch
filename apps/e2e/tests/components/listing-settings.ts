import type { Locator } from "@playwright/test";

/**
 * The apply button names its outcome — "Apply tested CSS selector", "Apply
 * automatic extraction" — and reads "Apply repair" only while disabled.
 */
const APPLY_REPAIR_PATTERN = /^Apply /;
/** The read-only sentence that replaced the extractor select. */
const EXTRACTION_NOTE_PATTERN = /^(Found automatically|Read from a spot)/;
const EXPECTED_PRICE_PATTERN = /^What price does this page show\?/;
const ADVANCED_PATTERN = /^Advanced: point at the price/;
const LOCATED_PATTERN = /^Found that price here/;
/** Any of the three ways the locator says it has no spot to offer. */
const NOT_FOUND_PATTERN =
  /^(That price is not on the page|We could not find that price|That price is on the page, but)/;

/**
 * The inline per-listing settings editor a `ListingRow` opens via `edit()`.
 * Scoped to the row's own container (not the page), since two rows can be in
 * edit mode at once and their forms would otherwise be indistinguishable.
 */
export class ListingSettingsForm {
  /** The disclosure hiding the hand-written picker. Closed by default. */
  readonly advancedToggle: Locator;
  readonly applyRepairButton: Locator;
  readonly browserRenderCheckbox: Locator;
  /** The one question the repair asks. */
  readonly expectedPriceInput: Locator;
  /** How the price is found, now read-only — the repair panel is the only editor. */
  readonly extractionNote: Locator;
  readonly locatedNote: Locator;
  /** Shown when the typed price yields no spot to track. */
  readonly notFoundNote: Locator;
  readonly repairButton: Locator;
  readonly saveButton: Locator;
  readonly singleMatchNote: Locator;
  private readonly row: Locator;

  constructor(row: Locator) {
    this.row = row;
    this.browserRenderCheckbox = row.getByRole("checkbox", {
      name: "Load the page in a headless browser",
    });
    this.extractionNote = row.getByText(EXTRACTION_NOTE_PATTERN);
    this.expectedPriceInput = row.getByLabel(EXPECTED_PRICE_PATTERN);
    this.locatedNote = row.getByText(LOCATED_PATTERN);
    this.notFoundNote = row.getByText(NOT_FOUND_PATTERN);
    this.advancedToggle = row.getByText(ADVANCED_PATTERN);
    this.repairButton = row.getByRole("button", { name: "Re-preview and repair" });
    this.applyRepairButton = row.getByRole("button", { name: APPLY_REPAIR_PATTERN });
    this.saveButton = row.getByRole("button", { name: "Save listing settings" });
    this.singleMatchNote = row.getByText("1 match", { exact: true });
  }

  /** The expression input, whose label follows the selected mode. */
  expressionInput(mode: "CSS selector" | "JSONPath"): Locator {
    return this.row.getByLabel(`${mode} for the price`);
  }

  /** Opens the hand-written picker. Idempotent — a second click would close it. */
  async openAdvanced(): Promise<void> {
    const input = this.expressionInput("CSS selector");
    if (await input.isVisible()) {
      return;
    }
    await this.advancedToggle.click();
    await input.waitFor();
  }

  /** Tells the repair what the page shows and waits for it to find the spot. */
  async locatePrice(price: string): Promise<void> {
    await this.expectedPriceInput.fill(price);
    await this.locatedNote.waitFor();
  }
}
