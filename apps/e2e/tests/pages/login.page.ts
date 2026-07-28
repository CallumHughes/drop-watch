import type { Locator, Page } from "@playwright/test";

/**
 * /login — sign-in, and account creation while the instance has no account.
 * Both "Sign In" texts exist twice on the page (header link + form submit), so
 * everything here is scoped to the form.
 */
export class LoginPage {
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly nameInput: Locator;
  readonly signInButton: Locator;
  readonly signUpButton: Locator;
  /** The switch into the sign-up form; only rendered while signup is open. */
  readonly signUpSwitch: Locator;
  readonly signInHeading: Locator;
  readonly signUpHeading: Locator;
  readonly forgotPasswordLink: Locator;
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
    const form = page.locator("form");
    this.emailInput = form.getByLabel("Email");
    this.passwordInput = form.getByLabel("Password");
    this.nameInput = form.getByLabel("Name");
    this.signInButton = form.getByRole("button", { exact: true, name: "Sign In" });
    this.signUpButton = form.getByRole("button", { exact: true, name: "Sign Up" });
    this.signUpSwitch = page.getByRole("button", { name: "Need an account? Sign Up" });
    this.signInHeading = page.getByRole("heading", { name: "Welcome Back" });
    this.signUpHeading = page.getByRole("heading", { name: "Create Account" });
    this.forgotPasswordLink = page.getByRole("link", { name: "Forgot password?" });
  }

  async goto(): Promise<void> {
    await this.page.goto("/login");
  }

  async login(email: string, password: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.signInButton.click();
  }

  /** Creates the account through the UI; only works while signup is open. */
  async signUp(name: string, email: string, password: string): Promise<void> {
    await this.signUpSwitch.click();
    await this.nameInput.fill(name);
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.signUpButton.click();
  }
}
