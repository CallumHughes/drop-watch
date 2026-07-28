import type { Locator, Page } from "@playwright/test";

/**
 * /reset-password — where the link in the reset mail lands, token in the
 * query string. Never navigated to directly: the token is the authorisation,
 * so a spec arrives here by following the mail's link.
 */
export class ResetPasswordPage {
  readonly heading: Locator;
  readonly newPasswordInput: Locator;
  readonly confirmPasswordInput: Locator;
  readonly submitButton: Locator;
  readonly updatedToast: Locator;
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole("heading", { name: "Set a new password" });
    // exact — "New password" is a substring of the confirm field's label.
    this.newPasswordInput = page.getByLabel("New password", { exact: true });
    this.confirmPasswordInput = page.getByLabel("Confirm new password");
    this.submitButton = page.getByRole("button", { name: "Set new password" });
    this.updatedToast = page.getByText("Password updated. Sign in with the new one.");
  }

  async reset(password: string): Promise<void> {
    await this.newPasswordInput.fill(password);
    await this.confirmPasswordInput.fill(password);
    await this.submitButton.click();
  }
}
