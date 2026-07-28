import type { Locator, Page } from "@playwright/test";

const PRODUCT_URL_PATTERN = /\/products\/(?<id>[0-9a-f-]{36})$/;
const STRATEGY_NOTE_PATTERN = /found by/;
const NO_AUTO_MATCH_PATTERN = /Nothing matched automatically/;

/** /products/new — paste a URL, preview the extraction, save. */
export class AddProductPage {
  readonly urlInput: Locator;
  readonly fetchPreviewButton: Locator;
  /** "found by schema.org JSON-LD" etc — proof of which strategy won. */
  readonly strategyNote: Locator;
  readonly pickMyselfButton: Locator;
  /** Shown when the automatic chain found nothing and the picker is the next step. */
  readonly noAutoMatchNote: Locator;
  readonly selectorInput: Locator;
  readonly trackButton: Locator;
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
    this.urlInput = page.getByLabel("Product URL");
    this.fetchPreviewButton = page.getByRole("button", { name: "Fetch preview" });
    this.strategyNote = page.getByText(STRATEGY_NOTE_PATTERN);
    this.pickMyselfButton = page.getByRole("button", { name: "Pick the price myself" });
    this.noAutoMatchNote = page.getByText(NO_AUTO_MATCH_PATTERN);
    this.selectorInput = page.getByLabel("CSS selector for the price");
    this.trackButton = page.getByRole("button", { name: "Track this product" });
  }

  async goto(): Promise<void> {
    await this.page.goto("/products/new");
  }

  async fetchPreview(url: string): Promise<void> {
    await this.urlInput.fill(url);
    await this.fetchPreviewButton.click();
  }

  /**
   * Saves whatever the preview currently shows and waits for the redirect to
   * the new product's page. Returns the product id from the URL.
   */
  async track(): Promise<string> {
    await this.trackButton.click();
    await this.page.waitForURL(PRODUCT_URL_PATTERN);
    const id = PRODUCT_URL_PATTERN.exec(this.page.url())?.groups?.id;
    if (!id) {
      throw new Error(`expected a product URL, got ${this.page.url()}`);
    }
    return id;
  }
}
