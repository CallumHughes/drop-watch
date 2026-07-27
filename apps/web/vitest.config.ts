import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Covers the pure display helpers only — no jsdom, no component rendering. The
 * components are thin over `@price-tracker/api`, and what is actually easy to
 * get wrong here is the money and time formatting.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
