import "@price-tracker/env/web";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Product images come from whatever retailer the user is tracking, so the
    // host set is open by construction. They are served unoptimised: proxying
    // and re-encoding arbitrary third-party images through the Next image
    // optimiser buys nothing on a single-user LAN dashboard and would make the
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
