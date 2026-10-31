import { APP_DESCRIPTION, APP_NAME } from "@drop-watch/brand";
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    background_color: "#0a0a0a",
    description: APP_DESCRIPTION,
    display: "standalone",
    icons: [
      { sizes: "192x192", src: "/icon-192.png", type: "image/png" },
      { sizes: "512x512", src: "/icon-512.png", type: "image/png" },
      // Launchers crop to their own shape, so this one runs full bleed and
      // keeps the mark inside the safe zone.
      { purpose: "maskable", sizes: "512x512", src: "/icon-maskable-512.png", type: "image/png" },
    ],
    name: APP_NAME,
    short_name: APP_NAME,
    start_url: "/",
    theme_color: "#0a0a0a",
  };
}
