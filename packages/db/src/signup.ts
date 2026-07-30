/**
 * Whether self-service signup is still open.
 *
 * Open only until the instance has its first account, which becomes the admin.
 * Everyone after that joins by invite. The check is a live query rather than a
 * static `emailAndPassword.disableSignUp` flag so a fresh install with no seed
 * run can still be bootstrapped from the login page — it slams shut the moment
 * the first account exists.
 *
 * Lives in `@drop-watch/db` because both sides need it: `@drop-watch/auth`
 * enforces it on the sign-up endpoint, and `@drop-watch/api` exposes it so
 * the login page knows whether to offer the form at all.
 */

import { db } from "./index";
import { user } from "./schema/auth";

export async function signupOpen(): Promise<boolean> {
  const [existing] = await db.select({ id: user.id }).from(user).limit(1);
  return !existing;
}
