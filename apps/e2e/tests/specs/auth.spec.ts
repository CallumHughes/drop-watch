import { ADMIN_EMAIL, ADMIN_PASSWORD } from "../../constants";
import { expect, test } from "../fixtures";

const HTTP_OK = 200;
const INVALID_CREDENTIALS_PATTERN = /invalid email or password/i;

/**
 * Every test here runs without the shared storage state: they exercise the
 * logged-out surface, and the ones that do sign in create (and in one case
 * revoke) their own session rather than touching the one every other spec
 * shares.
 */
test.describe("authentication", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("signup is closed once the account exists", async ({ loginPage }) => {
    await loginPage.goto();
    await expect(loginPage.signInHeading).toBeVisible();
    await expect(loginPage.signUpSwitch).toBeHidden();
  });

  test("the dashboard redirects a signed-out visitor to login", async ({ loginPage, page }) => {
    await page.goto("/dashboard");
    await page.waitForURL("**/login");
    await expect(loginPage.signInHeading).toBeVisible();
  });

  test("the add-product page redirects a signed-out visitor to login", async ({ page }) => {
    await page.goto("/products/new");
    await page.waitForURL("**/login");
  });

  test("a wrong password is rejected with an error", async ({ loginPage, page }) => {
    await loginPage.goto();
    await loginPage.login(ADMIN_EMAIL, "definitely-not-the-password");
    await expect(page.getByText(INVALID_CREDENTIALS_PATTERN)).toBeVisible();
    await expect(loginPage.signInHeading).toBeVisible();
  });

  test("signing in lands on the dashboard", async ({ header, loginPage, page }) => {
    await loginPage.goto();
    await loginPage.login(ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.waitForURL("**/dashboard");
    await expect(header.userMenuButton).toBeVisible();
  });

  test("signing out ends the session", async ({ header, loginPage, page }) => {
    await test.step("sign in with a session of this test's own", async () => {
      await loginPage.goto();
      await loginPage.login(ADMIN_EMAIL, ADMIN_PASSWORD);
      await page.waitForURL("**/dashboard");
    });

    await test.step("sign out returns to the public home page", async () => {
      await header.signOut();
      await expect(header.signInLink).toBeVisible();
      await page.goto("/dashboard");
      await page.waitForURL("**/login");
    });
  });

  test("email-only routes exist while a mailer is configured", async ({ loginPage, page }) => {
    await loginPage.goto();
    await expect(loginPage.signInHeading).toBeVisible();
    await expect(loginPage.forgotPasswordLink).toBeVisible();

    const response = await page.goto("/forgot-password");
    expect(response?.status()).toBe(HTTP_OK);
  });
});
