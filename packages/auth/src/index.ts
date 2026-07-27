import { createDb } from "@price-tracker/db";
// biome-ignore lint/performance/noNamespaceImport: drizzle adapter requires the full schema object.
import * as schema from "@price-tracker/db/schema/auth";
import { signupOpen } from "@price-tracker/db/signup";
import { env } from "@price-tracker/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";

/** The endpoint the guard below closes. */
const SIGN_UP_PATH = "/sign-up/email";

/**
 * Signup is open exactly until the first account exists.
 *
 * This tracker is single-user (PLAN.md §8): one seeded admin, and no way for
 * anyone reaching the LAN to add themselves afterwards. A live check rather
 * than the static `emailAndPassword.disableSignUp` flag, so a fresh install
 * that has not been seeded can still be bootstrapped from the login page — and
 * so the door shuts the moment it has been.
 *
 * Enforced here rather than only in the UI because hiding a form is not
 * security; the endpoint is what is actually exposed.
 */
const closeSignupAfterFirstUser = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== SIGN_UP_PATH) {
    return;
  }
  if (!(await signupOpen())) {
    throw new APIError("FORBIDDEN", {
      code: "SIGN_UP_DISABLED",
      message: "Signup is disabled. This tracker already has an account.",
    });
  }
});

export function createAuth() {
  const db = createDb();

  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    database: drizzleAdapter(db, {
      provider: "pg",

      schema,
    }),
    emailAndPassword: {
      enabled: true,
    },
    hooks: {
      before: closeSignupAfterFirstUser,
    },
    plugins: [nextCookies()],
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.CORS_ORIGIN],
  });
}

export const auth = createAuth();
