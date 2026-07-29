import { defineConfig } from "vitest/config";

import { INTEGRATION_DATABASE_URL } from "./test/constants";

export default defineConfig({
  test: {
    // Set on process.env in each worker before any test module loads, so it
    // wins over dotenv (which never overrides existing vars) and over the
    // developer's shell. Empty strings become undefined via the env schema's
    // emptyStringAsUndefined — the same neutralisation trick as
    // apps/e2e/constants.ts.
    env: {
      DATABASE_URL: INTEGRATION_DATABASE_URL,
      HA_URL: "",
      HA_WEBHOOK_ID: "",
      NODE_ENV: "test",
    },
    // The suites share one database, and src/index.ts caches the db singleton
    // on globalThis (which vitest's module-cache reset does not clear) — so
    // every file gets its own forked process, run one at a time.
    fileParallelism: false,
    globalSetup: ["./test/global-setup.ts"],
    hookTimeout: 60_000,
    include: ["src/**/*.integration.test.ts"],
    pool: "forks",
    testTimeout: 30_000,
  },
});
