import type { Locator, Page } from "@playwright/test";

/**
 * /invite/[token] — where an invite link lands.
 *
 * A live token renders the sign-up form with the email locked to the invited
 * address; a dead one (made up, expired, revoked or already used) renders a
 * static explanation instead. Signed-in visitors never see either — the page
 * redirects them to the dashboard — so specs drive this through an
 * unauthenticated context.
 */
export class InvitePage {
  readonly createAccountHeading: Locator;
  /** Prefilled with the invited address and disabled — UX for a server rule. */
  readonly emailInput: Locator;
  readonly nameInput: Locator;
  readonly passwordInput: Locator;
  readonly signUpButton: Locator;
  readonly invalidHeading: Locator;
  readonly invalidCopy: Locator;
  readonly goToSignInLink: Locator;
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
    this.createAccountHeading = page.getByRole("heading", { name: "Create Account" });
    this.emailInput = page.getByLabel("Email");
    this.nameInput = page.getByLabel("Name");
    this.passwordInput = page.getByLabel("Password");
    this.signUpButton = page.getByRole("button", { exact: true, name: "Sign Up" });
    this.invalidHeading = page.getByRole("heading", { name: "Invite not valid" });
    this.invalidCopy = page.getByText(
      "This invite link is no longer valid. Ask the admin to send a new one."
    );
    this.goToSignInLink = page.getByRole("link", { name: "Go to sign in" });
  }

  /** Accepts either a bare token or the full revealed link. */
  async goto(tokenOrUrl: string): Promise<void> {
    await this.page.goto(tokenOrUrl.startsWith("http") ? tokenOrUrl : `/invite/${tokenOrUrl}`);
  }

  /** Completes the form; the email is already locked to the invited address. */
  async signUp(name: string, password: string): Promise<void> {
    await this.nameInput.fill(name);
    await this.passwordInput.fill(password);
    await this.signUpButton.click();
  }
}
