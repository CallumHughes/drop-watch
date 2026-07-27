import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

// Minimal schema for anything that only touches the database (the db package
// itself, drizzle-kit, the worker) — importing it must not demand web-only
// config like Better Auth secrets.
export const env = createEnv({
  emptyStringAsUndefined: true,
  runtimeEnv: process.env,
  server: {
    DATABASE_URL: z.string().min(1),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
