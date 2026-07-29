import type { Locator, Page } from "@playwright/test";

/** /dashboard — the product card grid. */
export class DashboardPage {
  /** The empty state an account with no products of its own sees. */
  readonly emptyState: Locator;
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
    this.emptyState = page.getByText("Nothing tracked yet");
  }

  async goto(): Promise<void> {
    await this.page.goto("/dashboard");
  }

  /**
   * The card title link for one product. Titles are unique per test (each test
   * owns its fixture product), which is what keeps parallel runs from seeing
   * each other's cards.
   */
  productLink(title: string): Locator {
    return this.page.getByRole("link", { exact: true, name: title });
  }
}
