import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

// The worker must not require Better Auth config — only the database and
// (once alerting lands) the Home Assistant webhook.
export const env = createEnv({
  emptyStringAsUndefined: true,
  runtimeEnv: process.env,
  server: {
    DATABASE_URL: z.string().min(1),
    HA_URL: z.url().optional(),
    HA_WEBHOOK_ID: z.string().min(1).optional(),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
