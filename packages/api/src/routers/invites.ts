/**
 * Admin-issued invites — the only door into this tracker once the bootstrap
 * account exists.
 *
 * The API half is deliberately thin: `@drop-watch/db/invites` owns tokens,
 * hashing and expiry, and the signup hook in `@drop-watch/auth` is the
 * enforcement point. Everything here exists for the admin page (create, list,
 * revoke) and for the invite landing page (check) — none of it is what keeps a
 * stranger out.
 */

import {
  createInvite,
  findPendingInvite,
  listPendingInvites,
  revokeInvite,
} from "@drop-watch/db/invites";
import { emailEnabled, sendInviteEmail } from "@drop-watch/email";
import { env } from "@drop-watch/env/server";
import { z } from "zod";

import { adminProcedure, publicProcedure } from "../index";

/**
 * A pending invite as the admin page lists it. `expired` is derived
 * server-side so the UI never compares timestamps across clock skew.
 */
export interface PendingInvite {
  createdAt: Date;
  email: string;
  expired: boolean;
  expiresAt: Date;
  id: string;
}

/**
 * What `create` hands back. `already_registered` is a return value rather
 * than a thrown error because the admin page shows it inline next to the
 * email box — it is feedback on the input, not a failure of the call. On the
 * success side the `url` is always present: a failed email send only means
 * the admin must copy the link by hand, which `emailError` tells them.
 */
export type CreateInviteResult =
  | { error: "already_registered" }
  | { emailError?: string; emailed: boolean; url: string };

export const invitesRouter = {
  /**
   * Whether a raw invite token is still good, and for which address, so the
   * landing page can prefill the form or show "link dead" without a
   * round-trip through signup. Public by necessity — the visitor holding the
   * link has no session yet — and an acceptable oracle: tokens are 256 random
   * bits, so the only tokens anyone can "check" are ones they were given.
   */
  check: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .handler(async ({ input }): Promise<{ email: string; valid: true } | { valid: false }> => {
      const invite = await findPendingInvite(input.token);
      return invite ? { email: invite.email, valid: true } : { valid: false };
    }),

  /**
   * Creates (or regenerates — the db helper deletes any pending invite for
   * the address first) an invite and, when a mailer is configured, mails the
   * link. A failed send is *not* an error: the returned `url` is the same
   * link, and the admin copying it by hand is the designed fallback on
   * mailer-less installs.
   */
  create: adminProcedure
    .input(z.object({ email: z.email() }))
    .handler(async ({ context, input }): Promise<CreateInviteResult> => {
      const created = await createInvite(input.email, context.session.user.id);
      if ("error" in created) {
        return created;
      }

      const url = new URL(`/invite/${created.token}`, env.BETTER_AUTH_URL).toString();
      if (!emailEnabled()) {
        return { emailed: false, url };
      }

      const sent = await sendInviteEmail({ to: input.email, url });
      return sent.ok ? { emailed: true, url } : { emailError: sent.error, emailed: false, url };
    }),

  list: adminProcedure.handler((): Promise<PendingInvite[]> => listPendingInvites()),

  revoke: adminProcedure
    .input(z.object({ id: z.string() }))
    .handler(({ input }): Promise<void> => revokeInvite(input.id)),
};
