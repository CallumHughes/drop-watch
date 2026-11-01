import type { Locator, Page } from "@playwright/test";

const PRODUCT_URL_PATTERN = /\/products\/(?<id>[0-9a-f-]{36})$/;
const STRATEGY_NOTE_PATTERN = /found by/;
const NO_AUTO_MATCH_PATTERN = /Nothing matched automatically/;
const BROWSER_RELOAD_BUTTON_PATTERN = /Reload(?:ing)? in browser/;
const HTTP_RELOAD_BUTTON_PATTERN = /Reload(?:ing)? with HTTP/;
const AUTOMATIC_REPAIR_PATTERN = /automatic price is ambiguous/;
const EXPECTED_PRICE_PATTERN = /^What price does this page show\?/;
const ADVANCED_PATTERN = /^Advanced: point at the price/;
const LOCATED_PATTERN = /^Found that price here/;
/** The panel's line when a browser attempt in this same preview already failed. */
const BROWSER_ALREADY_FAILED_PATTERN = /already tried a browser and it failed/;

/** /products/new — paste a URL, preview the extraction, save. */
export class AddProductPage {
  readonly urlInput: Locator;
  readonly loadPreviewButton: Locator;
  /** "found by schema.org JSON-LD" etc — proof of which strategy won. */
  readonly strategyNote: Locator;
  readonly pickMyselfButton: Locator;
  /** Available on HTTP previews when a user wants a rendered DOM. */
  readonly reloadInBrowserButton: Locator;
  /** Available on browser previews to replace them with a fresh HTTP response. */
  readonly reloadWithHttpButton: Locator;
  /** Shown when the automatic chain found nothing and the picker is the next step. */
  readonly noAutoMatchNote: Locator;
  /** Guardrail shown when automatic extraction found an unsafe candidate. */
  readonly automaticRepairWarning: Locator;
  /** Provenance displayed when the successful preview came from the renderer sidecar. */
  readonly browserRenderProvenance: Locator;
  /**
   * Shown instead of a pointless second render: automatic mode escalated to the
   * browser itself, that attempt failed, and the reason is reported here.
   */
  readonly browserAlreadyFailedNote: Locator;
  /** The one question the flow asks; everything else is derived from it. */
  readonly expectedPriceInput: Locator;
  /** Confirmation that the typed price was found, and where. */
  readonly locatedNote: Locator;
  /** The disclosure hiding the hand-written picker. Closed by default. */
  readonly advancedToggle: Locator;
  readonly selectorInput: Locator;
  readonly jsonPathInput: Locator;
  readonly trackButton: Locator;
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
    this.urlInput = page.getByLabel("Product URL");
    this.loadPreviewButton = page.getByRole("button", { name: "Load preview" });
    this.strategyNote = page.getByText(STRATEGY_NOTE_PATTERN);
    this.pickMyselfButton = page.getByRole("button", { name: "Set the price myself" });
    this.reloadInBrowserButton = page.getByRole("button", {
      name: BROWSER_RELOAD_BUTTON_PATTERN,
    });
    this.reloadWithHttpButton = page.getByRole("button", {
      name: HTTP_RELOAD_BUTTON_PATTERN,
    });
    this.noAutoMatchNote = page.getByText(NO_AUTO_MATCH_PATTERN);
    this.automaticRepairWarning = page.getByText(AUTOMATIC_REPAIR_PATTERN);
    this.browserRenderProvenance = page.getByText("rendered in a browser");
    this.browserAlreadyFailedNote = page.getByText(BROWSER_ALREADY_FAILED_PATTERN);
    this.expectedPriceInput = page.getByLabel(EXPECTED_PRICE_PATTERN);
    this.locatedNote = page.getByText(LOCATED_PATTERN);
    this.advancedToggle = page.getByText(ADVANCED_PATTERN);
    this.selectorInput = page.getByLabel("CSS selector for the price");
    this.jsonPathInput = page.getByLabel("JSONPath for the price");
    this.trackButton = page.getByRole("button", { name: "Track this product" });
  }

  /**
   * Opens the hand-written picker, which no longer sits on the page by default.
   * Idempotent: clicking an open `details` would close it again.
   */
  async openAdvanced(): Promise<void> {
    if (await this.selectorInput.isVisible()) {
      return;
    }
    await this.advancedToggle.click();
    await this.selectorInput.waitFor();
  }

  /** Tells the flow what the page shows and waits for it to find the spot. */
  async locatePrice(price: string): Promise<void> {
    await this.expectedPriceInput.fill(price);
    await this.locatedNote.waitFor();
  }

  /** The picker's mode buttons — "CSS selector" and "JSONPath". */
  mode(name: "CSS selector" | "JSONPath"): Locator {
    return this.page.getByRole("button", { exact: true, name });
  }

  async goto(): Promise<void> {
    await this.page.goto("/products/new");
  }

  async loadPreview(url: string): Promise<void> {
    await this.urlInput.fill(url);
    await this.loadPreviewButton.click();
  }

  /**
   * Saves whatever the preview currently shows and waits for the redirect to
   * the new product's page. Returns the product id from the URL.
   */
  async track(): Promise<string> {
    await this.trackButton.click();
    await this.page.waitForURL(PRODUCT_URL_PATTERN);
    const id = this.page.url().match(PRODUCT_URL_PATTERN)?.groups?.id;
    if (!id) {
      throw new Error(`expected a product URL, got ${this.page.url()}`);
    }
    return id;
  }
}
