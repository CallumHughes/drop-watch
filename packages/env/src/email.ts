import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

// Everything here is optional, and that is the whole design: `RESEND_API_KEY`
// is the switch that turns the mailer on, and webhook-only alerting is a
// supported configuration — so a self-hoster must be able to boot, migrate,
// sign in and run checks with none of these set.
//
// Imported by `@drop-watch/email` itself rather than by its consumers, the
// same trick `@drop-watch/db/settings` uses with `@drop-watch/env/db`:
// both `apps/web` and `apps/worker` pick the schema up transitively, and
// neither has to remember to.
export const env = createEnv({
  emptyStringAsUndefined: true,
  runtimeEnv: process.env,
  server: {
    /**
     * Absolute base URL used in links inside alert emails. The worker has no
     * `BETTER_AUTH_URL` of its own and a mail that says "open the dashboard"
     * without a URL is useless, so this is the one place both processes agree
     * on where the app lives. Falls back to `BETTER_AUTH_URL` on the web side.
     */
    APP_URL: z.url().optional(),
    /**
     * The `From:` address. Defaults to Resend's `onboarding@resend.dev`, which
     * needs no verified domain but which Resend will only deliver to the
     * address that owns the Resend account — fine while you are the only
     * recipient,
     * useless for anything else.
     */
    EMAIL_FROM: z.string().min(1).optional(),
    /** Unset means "no mailer". Nothing else in the repo may test this. */
    RESEND_API_KEY: z.string().min(1).optional(),
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
