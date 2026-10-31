/**
 * Keeps `DEFAULT_USER_AGENT` within a major of the Chromium Playwright ships.
 *
 * It lives here rather than beside the constant because `packages/core` must
 * not import Playwright, and it reads `browsers.json` off disk because that
 * file is not in playwright-core's `exports` map. The constant matters on both
 * transports: the renderer only falls back to it when the identity probe says
 * nothing, but the plain-HTTP path sends it on every fetch, so letting it drift
 * means every fetch advertises a browser several majors older than the one the
 * escalation would use.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { DEFAULT_USER_AGENT } from "@drop-watch/core/net/identity";
import { expect, it } from "vitest";

/** The user agent token carrying the version, e.g. `Chrome/156.0.0.0`. */
const CHROME_TOKEN = "Chrome/";

/** How many majors of drift to tolerate, so a Playwright roll is not a stop. */
const ALLOWED_DRIFT = 1;

function pinnedChromiumVersion(): string {
  const require = createRequire(import.meta.url);
  const core = require.resolve("playwright-core/package.json", {
    paths: [dirname(require.resolve("playwright/package.json"))],
  });
  const catalog = JSON.parse(readFileSync(join(dirname(core), "browsers.json"), "utf8")) as {
    browsers: { browserVersion: string; name: string }[];
  };
  const chromium = catalog.browsers.find((browser) => browser.name === "chromium");
  if (!chromium) {
    throw new Error("playwright-core's browsers.json lists no chromium");
  }
  return chromium.browserVersion;
}

function majorOf(version: string): number {
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  if (Number.isNaN(major)) {
    throw new Error(`no major version in "${version}"`);
  }
  return major;
}

/** The major `DEFAULT_USER_AGENT` claims, which it must claim to be of any use. */
function claimedChromeMajor(): number {
  const token = DEFAULT_USER_AGENT.split(" ").find((part) => part.startsWith(CHROME_TOKEN));
  if (token === undefined) {
    throw new Error(`DEFAULT_USER_AGENT names no Chrome version: "${DEFAULT_USER_AGENT}"`);
  }
  return majorOf(token.slice(CHROME_TOKEN.length));
}

it("claims a Chrome no more than a major behind the pinned Chromium", () => {
  const claimed = claimedChromeMajor();
  const pinned = majorOf(pinnedChromiumVersion());
  // Signed, not absolute: claiming a *newer* Chrome than exists is its own tell.
  const drift = pinned - claimed;

  expect(
    drift,
    `DEFAULT_USER_AGENT claims Chrome/${claimed}, Playwright ships ${pinned}`
  ).toBeGreaterThanOrEqual(0);
  expect(drift).toBeLessThanOrEqual(ALLOWED_DRIFT);
});
