/**
 * Who an alert email goes to.
 *
 * There is deliberately no "alert email address" field in `settings`. Alerts go
 * to the people who hold accounts on this tracker, resolved from the `user`
 * table at send time, because a typed-in address is a second copy of a fact the
 * database already knows — one that goes stale the moment somebody changes
 * their address, and one nobody ever remembers to update. The settings page
 * says so in as many words instead of offering a box to type into.
 *
 * Only *verified* addresses qualify. `emailVerified` is the only evidence the
 * tracker has that an address belongs to the person who claimed it, and mailing
 * an unverified one is how a typo in a sign-up form turns into a stranger
 * receiving price alerts for products they have never heard of.
 *
 * Today that is every account, because a product has no owner: the tracker is
 * single-user and `products` carries no `userId`. The intent is to open signup
 * later, at which point "who gets this alert" becomes a question about one
 * product rather than about the instance — so the answer is already a list
 * rather than an address, and already resolved per send rather than cached.
 * Adding the product to the call then changes this file and nothing else.
 */

import { eq } from "drizzle-orm";

import { db } from "./index";
import { user } from "./schema/auth";

/**
 * Every verified account address, for the email alert channel.
 *
 * Returns an empty list rather than throwing when nobody qualifies — an
 * install whose only account has never verified its address has *no email
 * channel*, which is a quiet, legitimate state and not a failure. Callers turn
 * an empty list into "do not build the channel"; see `alertTargets` in
 * `./settings`.
 */
export async function alertRecipients(): Promise<string[]> {
  const rows = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.emailVerified, true));
  return rows.map((row) => row.email);
}
