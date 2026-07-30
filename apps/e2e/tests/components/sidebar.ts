import type { Locator, Page } from "@playwright/test";

import { ADMIN_NAME } from "../../constants";

/** The signed-in shell's sidebar: nav links and the footer user dropdown. */
export class Sidebar {
  readonly addProductLink: Locator;
  readonly dashboardLink: Locator;
  readonly invitesLink: Locator;
  readonly settingsLink: Locator;
  /**
   * The user dropdown trigger. Its accessible name spans the user's name AND
   * email, so this is deliberately a substring match, not `exact`.
   */
  readonly userMenuButton: Locator;
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
    this.addProductLink = page.getByRole("link", { exact: true, name: "Add product" });
    this.dashboardLink = page.getByRole("link", { exact: true, name: "Dashboard" });
    this.invitesLink = page.getByRole("link", { exact: true, name: "Invites" });
    this.settingsLink = page.getByRole("link", { exact: true, name: "Settings" });
    this.userMenuButton = page.getByRole("button", { name: ADMIN_NAME });
  }

  /** An item inside the (open) user dropdown. */
  menuItem(name: string): Locator {
    return this.page.getByRole("menuitem", { exact: true, name });
  }

  /**
   * The dropdown trigger for an arbitrary signed-in user — `userMenuButton`
   * assumes the shared admin session, which specs driving their own accounts
   * cannot.
   */
  userMenuFor(name: string): Locator {
    return this.page.getByRole("button", { name });
  }

  async signOut(): Promise<void> {
    await this.userMenuButton.click();
    await this.menuItem("Sign Out").click();
  }
}
