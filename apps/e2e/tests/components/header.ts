import type { Locator, Page } from "@playwright/test";

import { ADMIN_NAME } from "../../constants";

/** The cross-page header: nav links and the user dropdown. */
export class Header {
  readonly dashboardLink: Locator;
  readonly settingsLink: Locator;
  /** The dropdown trigger, labelled with the signed-in user's name. */
  readonly userMenuButton: Locator;
  /** The "Sign In" link shown instead of the menu when signed out. */
  readonly signInLink: Locator;
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
    this.dashboardLink = page.getByRole("link", { exact: true, name: "Dashboard" });
    this.settingsLink = page.getByRole("link", { exact: true, name: "Settings" });
    this.userMenuButton = page.getByRole("button", { exact: true, name: ADMIN_NAME });
    this.signInLink = page.getByRole("link", { name: "Sign In" });
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
    return this.page.getByRole("button", { exact: true, name });
  }

  async signOut(): Promise<void> {
    await this.userMenuButton.click();
    await this.menuItem("Sign Out").click();
  }
}
