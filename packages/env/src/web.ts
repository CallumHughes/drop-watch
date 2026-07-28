import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

// The browser's copy of one server-side fact: whether a mailer is configured.
//
// Every page that only makes sense with email — `/forgot-password`,
// `/verify-email`, the change-email half of `/account` — is gated server-side
// on `emailEnabled()`, which is authoritative. This flag exists so the *links*
// to those pages can disappear too: a dead "forgot password?" link is worse
// than no link, and asking the API "do you have a mail key?" would answer that
// question for anyone who asks.
//
// `apps/web/next.config.ts` derives the default by calling `emailEnabled()`
// itself — the same predicate, not a second reading of `RESEND_API_KEY` — so
// in development setting the key alone is enough. `NEXT_PUBLIC_*` is inlined
// at build time, so a Docker image built without the key needs the value
// passed as a build argument — see README.md.
export const env = createEnv({
  client: {
    NEXT_PUBLIC_EMAIL_ENABLED: z.stringbool().default(false),
  },
  emptyStringAsUndefined: true,
  runtimeEnv: {
    NEXT_PUBLIC_EMAIL_ENABLED: process.env.NEXT_PUBLIC_EMAIL_ENABLED,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
