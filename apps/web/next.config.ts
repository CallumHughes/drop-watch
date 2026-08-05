import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Overridable so a second dev server (the e2e suite's, on its own port) can
  // run beside `pnpm dev` without the two fighting over one .next directory.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
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
