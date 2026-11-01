/**
 * The product's identity, in one place.
 *
 * The name was previously typed out in nine files across five workspaces, so
 * every package that renders it — the dashboard, auth, the mailer, the webhook
 * payloads — reads it from here instead. The artwork beside it in `assets/` is
 * the other half: both are canonical, and nothing downstream redefines either.
 */

/**
 * The product's name as it appears in headings, titles, subjects and footers.
 * Cased to match the wordmark, which sets "WATCH" in caps beside the script
 * "Drop" — so the text beside the artwork reads the same as the artwork.
 */
export const APP_NAME = "DropWATCH";

/** One line, for a tagline or a sidebar subtitle. */
export const APP_TAGLINE = "Self-hosted price tracking";

/** A sentence, for `<meta name="description">` and the web manifest. */
export const APP_DESCRIPTION =
  "Watch product pages for price changes, keep their history, and get alerted on a target price, a percentage drop, or a restock.";
