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
import { Header } from "./components/header";
import { AddProductPage } from "./pages/add-product.page";
import { DashboardPage } from "./pages/dashboard.page";
import { InvitePage } from "./pages/invite.page";
import { InvitesPage } from "./pages/invites.page";
import { LoginPage } from "./pages/login.page";
import { ProductDetailPage } from "./pages/product-detail.page";
import { SettingsPage } from "./pages/settings.page";
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
  header: Header;
  invitePage: InvitePage;
  page: Page;
}

interface Fixtures {
  addProduct: AddProductPage;
  dashboard: DashboardPage;
  /** This test's own product page on the fixture server, already published. */
  fixtureProduct: FixtureProduct;
  header: Header;
  invitePage: InvitePage;
  invites: InvitesPage;
  loginPage: LoginPage;
  productDetail: ProductDetailPage;
  settings: SettingsPage;
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
  fixtureProduct: async ({ request }, use) => {
    const product = new FixtureProduct(request);
    await product.publish();
    await use(product);
  },
  header: async ({ page }, use) => {
    await use(new Header(page));
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
  settings: async ({ page }, use) => {
    await use(new SettingsPage(page));
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
    await use({ header: new Header(page), invitePage: new InvitePage(page), page });
    await context.close();
  },
  webhookSink: async ({ request }, use) => {
    await use(new WebhookSink(request));
  },
});

export const expect = baseExpect;
