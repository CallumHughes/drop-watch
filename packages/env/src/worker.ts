import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

// The worker must not require Better Auth config — only the database.
//
// The Home Assistant webhook is deliberately *not* here: it is stored in the
// `settings` table, seeded once from `HA_URL` / `HA_WEBHOOK_ID` (declared in
// `./db`, which both apps already import) and editable from the settings page
// thereafter. Reading it from the environment here would make that page
// read-only for the worker.
export const env = createEnv({
  emptyStringAsUndefined: true,
  runtimeEnv: process.env,
  server: {
    DATABASE_URL: z.string().min(1),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
