import { ADMIN_EMAIL, ADMIN_PASSWORD } from "../../constants";
import { expect, test } from "../fixtures";
import { type CapturedEmail, extractAuthLink } from "../support/email-sink";

const RESET_SUBJECT_PATTERN = /^Reset your .* password$/;
const EMAIL_TIMEOUT_MS = 15_000;

/**
 * The whole recovery loop: ask for a link, receive the mail, spend the token,
 * sign in with the result.
 *
 * Runs without the shared storage state — recovery is a logged-out flow — and
 * is safe in the parallel bulk because the "new" password is the old one:
 * Better Auth does not revoke sessions on reset (the repo leaves
 * `revokeSessionsOnPasswordReset` unset), so the shared session and the shared
 * credential both survive.
 */
test.describe("password reset", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a reset link from the mail sets a working password", async ({
    emailSink,
    forgotPassword,
    loginPage,
    page,
    resetPassword,
    sidebar,
  }) => {
    await test.step("reach the form from the login page's link", async () => {
      await loginPage.goto();
      await loginPage.forgotPasswordLink.click();
      await expect(forgotPassword.heading).toBeVisible();
    });

    let resetMail: CapturedEmail | undefined;
    await test.step("requesting a reset sends the mail", async () => {
      await forgotPassword.requestReset(ADMIN_EMAIL);
      await expect(forgotPassword.confirmationText).toBeVisible();
      await expect
        .poll(
          async () => {
            const mails = await emailSink.messagesWithSubject(RESET_SUBJECT_PATTERN);
            resetMail = mails.findLast((mail) => mail.to.includes(ADMIN_EMAIL));
            return resetMail !== undefined;
          },
          { timeout: EMAIL_TIMEOUT_MS }
        )
        .toBe(true);
    });

    await test.step("the link lands on the reset form", async () => {
      if (!resetMail) {
        throw new Error("reset mail never captured");
      }
      await page.goto(extractAuthLink(resetMail, "/api/auth/reset-password"));
      await expect(resetPassword.heading).toBeVisible();
    });

    await test.step("setting the password returns to sign-in", async () => {
      await resetPassword.reset(ADMIN_PASSWORD);
      await expect(resetPassword.updatedToast).toBeVisible();
      await page.waitForURL("**/login");
    });

    await test.step("the password it set actually signs in", async () => {
      await loginPage.login(ADMIN_EMAIL, ADMIN_PASSWORD);
      await page.waitForURL((url) => url.pathname === "/");
      await expect(sidebar.userMenuButton).toBeVisible();
    });
  });
});
