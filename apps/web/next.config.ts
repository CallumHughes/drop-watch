import "@drop-watch/env/web";
import { emailEnabled } from "@drop-watch/email/client";
import type { NextConfig } from "next";

/**
 * The browser's copy of one server-side fact: whether a mailer is configured.
 *
 * Derived here, at build time, from the same `emailEnabled()` the server gates
 * on — never from `RESEND_API_KEY` directly, which only `@drop-watch/email`
 * may read, and never from an API call, which would answer "does this box have
 * a mail key?" for anyone who asks. All the flag buys is that the *links* to
 * the email-only pages can disappear; the routes themselves are gated
 * server-side, where the answer cannot be a stale build artefact.
 *
 * An explicit `NEXT_PUBLIC_EMAIL_ENABLED` wins, because a Docker image is
 * built without the runtime's environment: there the value has to arrive as a
 * build argument. Locally, setting the key alone is enough.
 *
 * Imported from `@drop-watch/email/client` rather than the package entry
 * point, which is the only place in the app that does so: the entry point is a
 * `.tsx` file, and Next's config loader — unlike the app's own compiler —
 * cannot parse JSX. `emailEnabled` is the same function either way.
 */
const emailFlag = process.env.NEXT_PUBLIC_EMAIL_ENABLED ?? String(emailEnabled());

const nextConfig: NextConfig = {
  // Overridable so a second dev server (the e2e suite's, on its own port) can
  // run beside `pnpm dev` without the two fighting over one .next directory.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  env: {
    NEXT_PUBLIC_EMAIL_ENABLED: emailFlag,
  },
  images: {
    // Product images come from whatever retailer the user is tracking, so the
    // host set is open by construction. They are served unoptimised: proxying
    // and re-encoding arbitrary third-party images through the Next image
    // optimiser buys nothing on a self-hosted LAN dashboard and would make the
    // app an open image proxy.
    remotePatterns: [
      { hostname: "**", protocol: "https" },
      { hostname: "**", protocol: "http" },
    ],
    unoptimized: true,
  },
  output: "standalone",
  reactCompiler: true,
  typedRoutes: true,
};

export default nextConfig;
