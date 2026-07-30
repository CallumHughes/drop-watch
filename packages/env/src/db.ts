import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

// Minimal schema for anything that only touches the database (the db package
// itself, drizzle-kit, the worker) — importing it must not demand web-only
// config like Better Auth secrets.
//
// The Home Assistant variables live here rather than in `worker.ts` because
// they are *seed values*, not runtime config: the `settings` table is created
// from them on first boot and edited in the UI thereafter.
// Both `apps/web` and `apps/worker` reach the webhook config through
// `@drop-watch/db/settings`, so one definition serves both.
export const env = createEnv({
  emptyStringAsUndefined: true,
  runtimeEnv: process.env,
  server: {
    DATABASE_URL: z.string().min(1),
    /** Base URL of the Home Assistant instance, e.g. http://homeassistant:8123. */
    HA_URL: z.url().optional(),
    /** The webhook id, which is itself the secret. */
    HA_WEBHOOK_ID: z.string().min(1).optional(),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
