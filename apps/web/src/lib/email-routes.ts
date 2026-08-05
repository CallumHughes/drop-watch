/**
 * The server-side gate on the pages that only exist when a mailer does.
 *
 * `/verify-email`, `/forgot-password`, `/reset-password` and the change-email
 * half of `/account` are all dead ends without Resend: a form that posts to an
 * endpoint Better Auth did not register, or a "check your inbox" for a mail
 * nobody sent. So they are not rendered at all — the routes 404 and the links
 * to them disappear, because a dead "forgot password?" link is worse than no
 * link.
 *
 * This is the authoritative gate. It asks `emailEnabled()`, the same
 * predicate `createAuth()` reads, at request time — `connection()` opts the
 * calling route out of static prerendering so the answer can never be a
 * build artefact baked into one image and wrong for everyone who runs it
 * without the key.
 */

import { emailEnabled } from "@drop-watch/email";
import { notFound } from "next/navigation";
import { connection } from "next/server";

/** 404s the current route unless a mailer is configured. */
export async function requireEmailEnabled(): Promise<void> {
  await connection();
  if (!emailEnabled()) {
    notFound();
  }
}
