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
 * This is the authoritative half of that gate. It asks `emailEnabled()`, the
 * same predicate `createAuth()` reads, at request time. The client half is
 * `NEXT_PUBLIC_EMAIL_ENABLED`, which only hides links and is baked in at build
 * time; if the two ever disagree — an image built with the flag and run
 * without the key, say — the worst case is a visible link to a 404, never a
 * form that silently does nothing.
 */

import { emailEnabled } from "@drop-watch/email";
import { notFound } from "next/navigation";

/** 404s the current route unless a mailer is configured. */
export function requireEmailEnabled(): void {
  if (!emailEnabled()) {
    notFound();
  }
}
