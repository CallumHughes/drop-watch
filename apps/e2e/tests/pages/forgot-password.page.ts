import type { Locator, Page } from "@playwright/test";

const CONFIRMATION_PATTERN = /a reset link is on its way/;

/** /forgot-password — asks for a reset link. Only exists while a mailer does. */
export class ForgotPasswordPage {
  readonly heading: Locator;
  readonly emailInput: Locator;
  readonly sendButton: Locator;
  /** Deliberately the same whether or not the address has an account. */
  readonly confirmationText: Locator;
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole("heading", { name: "Reset your password" });
    this.emailInput = page.getByLabel("Email");
    this.sendButton = page.getByRole("button", { name: "Send reset link" });
    this.confirmationText = page.getByText(CONFIRMATION_PATTERN);
  }

  async goto(): Promise<void> {
    await this.page.goto("/forgot-password");
  }

  async requestReset(email: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.sendButton.click();
  }
}
