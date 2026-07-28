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
import { ForgotPasswordPage } from "./pages/forgot-password.page";
import { LoginPage } from "./pages/login.page";
import { ProductDetailPage } from "./pages/product-detail.page";
import { ResetPasswordPage } from "./pages/reset-password.page";
import { SettingsPage } from "./pages/settings.page";
import { EmailSink } from "./support/email-sink";
import { FixtureProduct } from "./support/fixture-product";
import { WebhookSink } from "./support/webhook-sink";

interface Fixtures {
  addProduct: AddProductPage;
  dashboard: DashboardPage;
  emailSink: EmailSink;
  /** This test's own product page on the fixture server, already published. */
  fixtureProduct: FixtureProduct;
  forgotPassword: ForgotPasswordPage;
  header: Header;
  loginPage: LoginPage;
  productDetail: ProductDetailPage;
  resetPassword: ResetPasswordPage;
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
  emailSink: async ({ request }, use) => {
    await use(new EmailSink(request));
  },
  fixtureProduct: async ({ request }, use) => {
    const product = new FixtureProduct(request);
    await product.publish();
    await use(product);
  },
  forgotPassword: async ({ page }, use) => {
    await use(new ForgotPasswordPage(page));
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
  resetPassword: async ({ page }, use) => {
    await use(new ResetPasswordPage(page));
  },
  settings: async ({ page }, use) => {
    await use(new SettingsPage(page));
  },
  webhookSink: async ({ request }, use) => {
    await use(new WebhookSink(request));
  },
});

export const expect = baseExpect;
