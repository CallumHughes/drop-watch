import type { Locator, Page } from "@playwright/test";

/** /dashboard — the product card grid. */
export class DashboardPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
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
