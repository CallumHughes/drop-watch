import type { Locator, Page } from "@playwright/test";

/**
 * /invites — the admin's invite desk (admin-only; the page redirects everyone
 * else). Issuing an invite reveals the single-use link inline, which on this
 * mailer-off install is the only delivery path — `createInvite` returns it so
 * specs can hand it to an unauthenticated visitor.
 */
export class InvitesPage {
  readonly emailInput: Locator;
  readonly inviteButton: Locator;
  /** The revealed link for the most recently issued invite. */
  readonly revealedLink: Locator;
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.getByLabel("Email");
    this.inviteButton = page.getByRole("button", { exact: true, name: "Invite" });
    this.revealedLink = page.getByTestId("invite-url");
  }

  async goto(): Promise<void> {
    await this.page.goto("/invites");
  }

  /**
   * The pending-invites row for one address. Matched exactly, not by
   * substring — parallel tests each have a row in the shared list, and one
   * address must never resolve to another's row.
   */
  row(email: string): Locator {
    return this.page
      .getByRole("listitem")
      .filter({ has: this.page.getByText(email, { exact: true }) });
  }

  /** Issues an invite and returns the revealed single-use link. */
  async createInvite(email: string): Promise<string> {
    await this.emailInput.fill(email);
    await this.inviteButton.click();
    await this.revealedLink.waitFor();
    return await this.revealedLink.innerText();
  }

  /** Mints a fresh link for an address that already has a pending invite. */
  async regenerate(email: string): Promise<void> {
    await this.row(email).getByRole("button", { name: "Regenerate link" }).click();
  }

  async revoke(email: string): Promise<void> {
    await this.row(email).getByRole("button", { name: "Revoke" }).click();
  }
}
