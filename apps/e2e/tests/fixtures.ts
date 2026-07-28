/**
 * The single source of `test` and `expect` for every spec.
 *
 * Page objects and data helpers are composed here as fixtures, so specs
 * destructure what they need from the test signature and never construct
 * anything themselves. Fixtures are lazy: a spec only pays for the objects it
 * actually names.
 */

import { test as base, expect as baseExpect } from "@playwright/test";

import { Header } from "./components/header";
import { AddProductPage } from "./pages/add-product.page";
import { DashboardPage } from "./pages/dashboard.page";
import { LoginPage } from "./pages/login.page";
import { ProductDetailPage } from "./pages/product-detail.page";
import { SettingsPage } from "./pages/settings.page";
import { FixtureProduct } from "./support/fixture-product";
import { WebhookSink } from "./support/webhook-sink";

interface Fixtures {
  addProduct: AddProductPage;
  dashboard: DashboardPage;
  /** This test's own product page on the fixture server, already published. */
  fixtureProduct: FixtureProduct;
  header: Header;
  loginPage: LoginPage;
  productDetail: ProductDetailPage;
  settings: SettingsPage;
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
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  productDetail: async ({ page }, use) => {
    await use(new ProductDetailPage(page));
  },
  settings: async ({ page }, use) => {
    await use(new SettingsPage(page));
  },
  webhookSink: async ({ request }, use) => {
    await use(new WebhookSink(request));
  },
});

export const expect = baseExpect;
