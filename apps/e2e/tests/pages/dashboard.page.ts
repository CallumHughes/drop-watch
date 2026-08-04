import type { Locator, Page } from "@playwright/test";

/** / — the product card grid, which is the home page. */
export class DashboardPage {
  /** The empty state an account with no products of its own sees. */
  readonly emptyState: Locator;
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
    this.emptyState = page.getByText("Nothing tracked yet");
  }

  async goto(): Promise<void> {
    await this.page.goto("/");
  }

  /**
   * The card title link for one product. Titles are unique per test (each test
   * owns its fixture product), which is what keeps parallel runs from seeing
   * each other's cards.
   */
  productLink(title: string): Locator {
    return this.page.getByRole("link", { exact: true, name: title });
  }

  /**
   * The price shown on one product's card — for a multi-store product, the
   * cheapest active listing's. Scoped up from the title link to the card,
   * since the price carries no accessible name of its own.
   */
  productPrice(title: string): Locator {
    const card = this.productLink(title).locator(
      'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " relative ")][1]'
    );
    return card.locator(".tabular-nums");
  }
}
