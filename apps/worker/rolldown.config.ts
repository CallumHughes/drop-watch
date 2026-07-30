import { defineConfig } from "rolldown";

export default defineConfig({
  input: "src/index.ts",
  output: {
    // `check-types` also writes here.
    cleanDir: true,
    dir: "dist",
    format: "esm",
    sourcemap: true,
  },
  // Rebuilds `require` from `module.createRequire` for the CommonJS deps.
  platform: "node",
});
