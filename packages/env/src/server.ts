import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  emptyStringAsUndefined: true,
  runtimeEnv: process.env,
  server: {
    // Hostnames the SSRF guard in `@drop-watch/core/net/guard` exempts from its
    // private-address block, comma-separated. Declared here for validation and
    // discoverability; the guard reads `process.env` itself, because it is also
    // loaded by the renderer, which has no env package.
    ALLOWED_PRIVATE_HOSTS: z.string().optional(),
    // Unset means Better Auth's own default: on in production, off in
    // development. The e2e suite turns it off explicitly, because it drives a
    // production build from one address and sign-in allows 3 requests per 10s.
    AUTH_RATE_LIMIT_ENABLED: z.stringbool().optional(),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    CORS_ORIGIN: z.url(),
    DATABASE_URL: z.string().min(1),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
