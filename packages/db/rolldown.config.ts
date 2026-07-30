import { cpSync } from "node:fs";
import { defineConfig } from "rolldown";

export default defineConfig({
  input: "src/migrate.ts",
  output: {
    // `check-types` also writes here.
    cleanDir: true,
    dir: "dist",
    format: "esm",
    sourcemap: true,
  },
  // Rebuilds `require` from `module.createRequire` for the CommonJS deps.
  platform: "node",
  plugins: [
    {
      name: "copy-migrations",
      // The migrator reads the SQL from disk, so it ships beside the bundle.
      writeBundle() {
        cpSync("src/migrations", "dist/migrations", { recursive: true });
      },
    },
  ],
});
