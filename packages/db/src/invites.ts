/**
 * The invitation ledger behind invite-only signup.
 *
 * Signup opens for exactly one bootstrap account and is invite-only after
 * that; the sign-up hook in `@price-tracker/auth` enforces it and this module
 * is what it consults. The raw token is generated here, handed back exactly
 * once, and only its SHA-256 is stored — a leaked database dump must not be a
 * stack of working invite links. 256 random bits also mean the lookup can be a
 * plain equality on the hash: there is nothing to brute-force in 48 hours.
 *
 * Lives in `@price-tracker/db` because both sides need it: the auth hook
 * validates and burns tokens, and `@price-tracker/api` creates, lists and
 * revokes invites for the admin page.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { and, desc, eq, gt, isNull } from "drizzle-orm";

import { db } from "./index";
import { invitation, user } from "./schema/auth";

/**
 * How long an invite link works. Long enough to survive a weekend inbox,
 * short enough that a forgotten link is not a standing back door.
 */
const INVITE_TTL_MS = 48 * 60 * 60 * 1000;

/**
 * SHA-256 hex of a raw invite token — the only form the database ever sees.
 * Exported so the auth hook and the API agree on what "the token" means.
 */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Creates (or re-creates) an invite for an address.
 *
 * Refuses an address that already has an account — inviting it again could
 * only confuse, since the signup it leads to is doomed to a unique-violation.
 * Any *pending* invite for the address is deleted first, so "resend" is just
 * "create again": one live link per address, and regenerating an invite
 * invalidates the link that came before it.
 *
 * The returned `token` is the raw secret. This is the only moment it exists
 * outside the invite URL — store nothing, mail it or show it, then let go.
 */
export async function createInvite(
  email: string,
  invitedBy: string
): Promise<
  { error: "already_registered" } | { invite: typeof invitation.$inferSelect; token: string }
> {
  const address = email.toLowerCase();

  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, address))
    .limit(1);
  if (existing) {
    return { error: "already_registered" };
  }

  await db
    .delete(invitation)
    .where(and(eq(invitation.email, address), isNull(invitation.acceptedAt)));

  const token = randomBytes(32).toString("base64url");
  const [invite] = await db
    .insert(invitation)
    .values({
      email: address,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      id: randomUUID(),
      invitedBy,
      tokenHash: hashInviteToken(token),
    })
    .returning();
  if (!invite) {
    throw new Error("invite insert returned no row");
  }

  return { invite, token };
}

/**
 * The invite a raw token currently entitles someone to, or `null` — unknown,
 * already accepted and expired all look the same to the caller, because the
 * signup guard treats them the same: no account for you.
 */
export async function findPendingInvite(
  token: string
): Promise<typeof invitation.$inferSelect | null> {
  const [invite] = await db
    .select()
    .from(invitation)
    .where(
      and(
        eq(invitation.tokenHash, hashInviteToken(token)),
        isNull(invitation.acceptedAt),
        gt(invitation.expiresAt, new Date())
      )
    )
    .limit(1);
  return invite ?? null;
}

/**
 * Burns a token by stamping `acceptedAt`. Called from the auth hook only once
 * the user row exists, so a signup that fails halfway leaves the invite live.
 */
export async function markInviteAccepted(token: string): Promise<void> {
  await db
    .update(invitation)
    .set({ acceptedAt: new Date() })
    .where(eq(invitation.tokenHash, hashInviteToken(token)));
}

/**
 * Every invite still awaiting acceptance, newest first, for the admin page.
 *
 * Expired invites are included rather than filtered out — the admin needs to
 * see that a link went stale to know a regenerate is due — so each row
 * carries a derived `expired` flag instead of leaving the UI to compare
 * timestamps.
 */
export async function listPendingInvites(): Promise<
  { createdAt: Date; email: string; expired: boolean; expiresAt: Date; id: string }[]
> {
  const now = Date.now();
  const rows = await db
    .select({
      createdAt: invitation.createdAt,
      email: invitation.email,
      expiresAt: invitation.expiresAt,
      id: invitation.id,
    })
    .from(invitation)
    .where(isNull(invitation.acceptedAt))
    .orderBy(desc(invitation.createdAt));
  return rows.map((row) => ({ ...row, expired: row.expiresAt.getTime() <= now }));
}

/** Withdraws an invite. Its link stops working the moment the row is gone. */
export async function revokeInvite(id: string): Promise<void> {
  await db.delete(invitation).where(eq(invitation.id, id));
}
