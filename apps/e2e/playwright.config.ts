import { defineConfig, devices } from "@playwright/test";

import { ADMIN_STORAGE_STATE, appEnv, BASE_URL, FIXTURE_URL, WEB_PORT } from "./constants";

/**
 * The suite runs fully parallel against one web server, one worker and one
 * throwaway database (recreated by global setup each run). Isolation is by
 * data, not by process: every test tracks its own fixture product on a unique
 * URL, and the one shared mutable resource — the singleton settings row — is
 * only written by the `chromium-serial` project, which runs after the parallel
 * bulk has finished.
 *
 * `auth.setup.ts` runs first on the fresh database: it exercises the
 * signup-open path, creates the instance's only account, and saves the signed
 * in storage state every other test reuses.
 */
export default defineConfig({
  expect: {
    // The dashboard polls every 15s (LIVE_REFETCH_MS), so an assertion
    // waiting on it must survive one full cycle. The product page is quicker —
    // it drops to ~1s while a check it requested is outstanding — but this
    // ceiling covers the slower of the two.
    timeout: 20_000,
  },
  forbidOnly: !!process.env.CI,
  fullyParallel: true,
  globalSetup: "./global/setup.ts",
  projects: [
    {
      name: "setup",
      testMatch: "setup/**/*.setup.ts",
    },
    {
      dependencies: ["setup"],
      name: "chromium",
      testIgnore: "specs/serial/**",
      testMatch: "specs/**/*.spec.ts",
      use: { ...devices["Desktop Chrome"], storageState: ADMIN_STORAGE_STATE },
    },
    {
      dependencies: ["chromium"],
      fullyParallel: false,
      name: "chromium-serial",
      testMatch: "specs/serial/**/*.spec.ts",
      use: { ...devices["Desktop Chrome"], storageState: ADMIN_STORAGE_STATE },
    },
  ],
  // `list` first in CI: html writes to disk and github only annotates failures,
  // so without it the log is a row of dots and a summary.
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }], ["github"]] : "list",
  retries: process.env.CI ? 1 : 0,
  testDir: "./tests",
  timeout: 60_000,
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      // CI serves a real build (the workflow runs `next build` first); local
      // runs stay on the dev server so a single spec needs no rebuild.
      command: process.env.CI
        ? `pnpm --filter @drop-watch/web exec next start --port ${WEB_PORT}`
        : `pnpm --filter @drop-watch/web exec next dev --port ${WEB_PORT}`,
      env: appEnv,
      reuseExistingServer: !process.env.CI,
      stdout: "ignore",
      timeout: 180_000,
      url: BASE_URL,
    },
    {
      command: "pnpm exec tsx fixture-server/server.ts",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      url: `${FIXTURE_URL}/__health`,
    },
  ],
  // Above the runner's 4 cores, which also host `next start`, the worker, the
  // fixture server and postgres — a spec spends most of its time waiting on a
  // poll or a worker pickup, not on CPU. Measured, not assumed.
  workers: process.env.CI ? 5 : undefined,
});
