/**
 * Whether self-service signup is still open.
 *
 * This tracker is single-user (PLAN.md §1, §8): one seeded admin, and signup
 * closed once that admin exists. The check is a live query rather than a static
 * `emailAndPassword.disableSignUp` flag so a fresh install with no seed run can
 * still be bootstrapped from the login page — it slams shut the moment the
 * first account exists, which is the behaviour EPICS.md asks for.
 *
 * Lives in `@price-tracker/db` because both sides need it: `@price-tracker/auth`
 * enforces it on the sign-up endpoint, and `@price-tracker/api` exposes it so
 * the login page knows whether to offer the form at all.
 */

import { db } from "./index";
import { user } from "./schema/auth";

export async function signupOpen(): Promise<boolean> {
  const [existing] = await db.select({ id: user.id }).from(user).limit(1);
  return !existing;
}
