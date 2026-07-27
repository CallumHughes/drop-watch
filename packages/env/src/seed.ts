import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/** Better Auth's own minimum, so a seeded password is one you can also sign up with. */
const MIN_PASSWORD_LENGTH = 8;

// Only the seed script reads this. The admin password has no default on purpose:
// a self-hosted dashboard shipping with a known credential is worse than a seed
// run that fails loudly and tells you what to set.
export const env = createEnv({
  emptyStringAsUndefined: true,
  runtimeEnv: process.env,
  server: {
    DATABASE_URL: z.string().min(1),
    SEED_ADMIN_EMAIL: z.email(),
    SEED_ADMIN_NAME: z.string().min(1).default("Admin"),
    SEED_ADMIN_PASSWORD: z.string().min(MIN_PASSWORD_LENGTH),
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
