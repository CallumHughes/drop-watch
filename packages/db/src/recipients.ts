/**
 * Who an alert email goes to: the product's owner.
 *
 * There is deliberately no "alert email address" field anywhere. Alerts go to
 * the account that owns the product, resolved from the `user` table at send
 * time, because a typed-in address is a second copy of a fact the database
 * already knows — one that goes stale the moment somebody changes their
 * address, and one nobody ever remembers to update.
 *
 * Only *verified* addresses qualify. `emailVerified` is the only evidence the
 * tracker has that an address belongs to the person who claimed it, and mailing
 * an unverified one is how a typo in a sign-up form turns into a stranger
 * receiving price alerts for products they have never heard of. The
 * verification gate itself lives in `alertTargets` (`./settings`), which turns
 * this row into a recipient list; this module only answers "who owns it".
 */

import { eq } from "drizzle-orm";

import { db } from "./index";
import { user } from "./schema/auth";

/** The alert-routing view of an account: address, consent, and role. */
export interface ProductOwner {
  email: string;
  emailAlertsEnabled: boolean;
  emailVerified: boolean;
  role: string | null;
}

/**
 * The account a product belongs to, or `null` when the row is gone (deletion
 * racing an in-flight check). A `null` is a quiet, legitimate state — the
 * caller turns it into "no channel", not an error.
 */
export async function productOwner(userId: string): Promise<ProductOwner | null> {
  const [row] = await db
    .select({
      email: user.email,
      emailAlertsEnabled: user.emailAlertsEnabled,
      emailVerified: user.emailVerified,
      role: user.role,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return row ?? null;
}
