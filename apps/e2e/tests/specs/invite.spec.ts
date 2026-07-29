import { expect, test } from "../fixtures";

const HTTP_FORBIDDEN = 403;

/**
 * Invite-only signup, both sides of the desk.
 *
 * The admin half runs on the shared storage state; the invitee half runs in
 * the `visitor` fixture's fresh unauthenticated context, because
 * /invite/[token] redirects any signed-in visitor to the dashboard. Each test
 * invites its own unique address, so the parallel workers never fight over a
 * pending-invites row — and the one account a test actually creates simply
 * persists, which no other spec minds: they key off the admin credentials and
 * their own products, never off the user count.
 */
test.describe("invites", () => {
  test("an invited address signs up through its link as a plain user", async ({
    invites,
    visitor,
  }) => {
    const inviteeEmail = "invitee@e2e.local";
    const inviteeName = "E2E Invitee";
    let inviteUrl = "";

    await test.step("the admin issues an invite and the link is revealed", async () => {
      await invites.goto();
      inviteUrl = await invites.createInvite(inviteeEmail);
      await expect(invites.revealedLink).toContainText("/invite/");
      await expect(invites.row(inviteeEmail)).toBeVisible();
    });

    await test.step("the link opens signup locked to the invited address", async () => {
      await visitor.invitePage.goto(inviteUrl);
      await expect(visitor.invitePage.createAccountHeading).toBeVisible();
      await expect(visitor.invitePage.emailInput).toHaveValue(inviteeEmail);
      await expect(visitor.invitePage.emailInput).toBeDisabled();
    });

    await test.step("completing the form lands on the dashboard, signed in", async () => {
      await visitor.invitePage.signUp(inviteeName, "invitee-password-1");
      await visitor.page.waitForURL("**/dashboard");
      await expect(visitor.header.userMenuFor(inviteeName)).toBeVisible();
    });

    await test.step("the new account is not an admin", async () => {
      await visitor.header.userMenuFor(inviteeName).click();
      await expect(visitor.header.menuItem("Account")).toBeVisible();
      await expect(visitor.header.menuItem("Invites")).toBeHidden();
      await visitor.page.keyboard.press("Escape");

      await visitor.page.goto("/invites");
      await visitor.page.waitForURL("**/dashboard");
    });
  });

  test("a revoked invite link lands on the invalid state", async ({ invites, visitor }) => {
    const inviteeEmail = "revocation-target@e2e.local";
    let inviteUrl = "";

    await test.step("issue an invite, then pull it back", async () => {
      await invites.goto();
      inviteUrl = await invites.createInvite(inviteeEmail);
      await invites.revoke(inviteeEmail);
      await expect(invites.row(inviteeEmail)).toBeHidden();
    });

    await test.step("the revealed link is now dead", async () => {
      await visitor.invitePage.goto(inviteUrl);
      await expect(visitor.invitePage.invalidHeading).toBeVisible();
      await expect(visitor.invitePage.invalidCopy).toBeVisible();
    });
  });

  test.describe("as a signed-out visitor", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("a made-up token shows the invalid state", async ({ invitePage }) => {
      await invitePage.goto("not-a-real-token");
      await expect(invitePage.invalidHeading).toBeVisible();
      await expect(invitePage.invalidCopy).toBeVisible();
      await expect(invitePage.goToSignInLink).toBeVisible();
    });

    test("signup without an invite token is refused at the API", async ({ request }) => {
      const response = await request.post("/api/auth/sign-up/email", {
        data: {
          email: "uninvited@e2e.local",
          name: "Uninvited User",
          password: "uninvited-password-1",
        },
      });
      expect(response.status()).toBe(HTTP_FORBIDDEN);
      const body = (await response.json()) as { code?: string };
      expect(body.code).toBe("SIGN_UP_DISABLED");
    });
  });
});
