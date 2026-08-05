/**
 * The single source of `test` and `expect` for every spec.
 *
 * Page objects and data helpers are composed here as fixtures, so specs
 * destructure what they need from the test signature and never construct
 * anything themselves. Fixtures are lazy: a spec only pays for the objects it
 * actually names.
 */

import { test as base, expect as baseExpect, type Page } from "@playwright/test";

import { BASE_URL } from "../constants";
import { Sidebar } from "./components/sidebar";
import { AddProductPage } from "./pages/add-product.page";
import { DashboardPage } from "./pages/dashboard.page";
import { ForgotPasswordPage } from "./pages/forgot-password.page";
import { InvitePage } from "./pages/invite.page";
import { InvitesPage } from "./pages/invites.page";
import { LoginPage } from "./pages/login.page";
import { ProductDetailPage } from "./pages/product-detail.page";
import { ResetPasswordPage } from "./pages/reset-password.page";
import { SettingsPage } from "./pages/settings.page";
import { EmailSink } from "./support/email-sink";
import { FixtureProduct } from "./support/fixture-product";
import { WebhookSink } from "./support/webhook-sink";

/**
 * A page in a fresh, unauthenticated browser context of the test's own.
 *
 * For flows that must not carry the shared admin session while the test's main
 * `page` keeps it — accepting an invite, above all: /invite/[token] redirects
 * any signed-in visitor to the dashboard, and the whole point of the flow is
 * to become someone other than the admin.
 */
interface Visitor {
  invitePage: InvitePage;
  page: Page;
  sidebar: Sidebar;
}

/**
 * A second, non-admin account signed in on a context of its own, alongside the
 * test's admin `page`. For everything per-user scoping is about: two accounts
 * looking at the same instance at once.
 *
 * Each test gets a brand-new account (invited by the admin, signed up through
 * the invite link), so nothing a test does to it — products, the email
 * toggle — can be seen by any other test. Invited accounts arrive already
 * email-verified, so `email` is immediately alertable.
 */
interface SecondUser {
  addProduct: AddProductPage;
  dashboard: DashboardPage;
  email: string;
  page: Page;
  productDetail: ProductDetailPage;
  settings: SettingsPage;
  sidebar: Sidebar;
}

const SECOND_USER_PASSWORD = "second-user-password-1";

interface Fixtures {
  addProduct: AddProductPage;
  dashboard: DashboardPage;
  emailSink: EmailSink;
  /**
   * This test's own product page on the fixture server, already published.
   * Served on the worker's own fixture host, so one worker's scrapes never
   * queue behind another's.
   */
  fixtureProduct: FixtureProduct;
  forgotPassword: ForgotPasswordPage;
  invitePage: InvitePage;
  invites: InvitesPage;
  loginPage: LoginPage;
  productDetail: ProductDetailPage;
  resetPassword: ResetPasswordPage;
  /**
   * A second published fixture page, for tests whose scenario needs a product
   * per account — same isolation model as `fixtureProduct`, distinct URL.
   */
  secondFixtureProduct: FixtureProduct;
  secondUser: SecondUser;
  settings: SettingsPage;
  sidebar: Sidebar;
  visitor: Visitor;
  webhookSink: WebhookSink;
}

export const test = base.extend<Fixtures>({
  addProduct: async ({ page }, use) => {
    await use(new AddProductPage(page));
  },
  dashboard: async ({ page }, use) => {
    await use(new DashboardPage(page));
  },
  emailSink: async ({ request }, use) => {
    await use(new EmailSink(request));
  },
  fixtureProduct: async ({ request }, use, testInfo) => {
    const product = new FixtureProduct(request, testInfo.parallelIndex);
    await product.publish();
    await use(product);
  },
  forgotPassword: async ({ page }, use) => {
    await use(new ForgotPasswordPage(page));
  },
  invitePage: async ({ page }, use) => {
    await use(new InvitePage(page));
  },
  invites: async ({ page }, use) => {
    await use(new InvitesPage(page));
  },
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  productDetail: async ({ page }, use) => {
    await use(new ProductDetailPage(page));
  },
  resetPassword: async ({ page }, use) => {
    await use(new ResetPasswordPage(page));
  },
  secondFixtureProduct: async ({ request }, use, testInfo) => {
    const product = new FixtureProduct(request, testInfo.parallelIndex);
    await product.publish();
    await use(product);
  },
  secondUser: async ({ browser, invites }, use, testInfo) => {
    // Unique per test: the parallel index separates workers, the timestamp
    // separates successive tests on one worker — no two second users ever
    // share an address, so mails and invite rows never cross tests.
    const email = `user-${testInfo.parallelIndex}-${Date.now()}@e2e.local`;

    // The invite is minted on the admin's own page; only the signup happens
    // in the fresh context, because /invite/[token] bounces signed-in
    // visitors and the whole point is to become someone else.
    await invites.goto();
    const inviteUrl = await invites.createInvite(email);

    const context = await browser.newContext({
      baseURL: BASE_URL,
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    const invitePage = new InvitePage(page);
    await invitePage.goto(inviteUrl);
    await invitePage.signUp(`E2E User ${testInfo.parallelIndex}`, SECOND_USER_PASSWORD);
    // The dashboard lives at "/", which globs match ambiguously — a predicate
    // is exact.
    await page.waitForURL((url) => url.pathname === "/");

    await use({
      addProduct: new AddProductPage(page),
      dashboard: new DashboardPage(page),
      email,
      page,
      productDetail: new ProductDetailPage(page),
      settings: new SettingsPage(page),
      sidebar: new Sidebar(page),
    });
    await context.close();
  },
  settings: async ({ page }, use) => {
    await use(new SettingsPage(page));
  },
  sidebar: async ({ page }, use) => {
    await use(new Sidebar(page));
  },
  visitor: async ({ browser }, use) => {
    // Options are passed explicitly rather than inherited: the empty
    // storageState is what makes the context unauthenticated, and the baseURL
    // keeps relative goto()s working.
    const context = await browser.newContext({
      baseURL: BASE_URL,
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    await use({ invitePage: new InvitePage(page), page, sidebar: new Sidebar(page) });
    await context.close();
  },
  webhookSink: async ({ request }, use) => {
    await use(new WebhookSink(request));
  },
});

export const expect = baseExpect;
