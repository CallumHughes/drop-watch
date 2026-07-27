import { hostnameKey } from "@price-tracker/core/fetch";
import { db } from "@price-tracker/db";
import { env } from "@price-tracker/env/worker";
import { sql } from "drizzle-orm";

// Bare entrypoint (Epic 1). pg-boss, the dispatcher, and checkProduct land in
// Epic 4 — until then this only proves the wiring: env validates, core and db
// import, and Postgres is reachable.

async function main() {
  console.info(`[worker] starting (NODE_ENV=${env.NODE_ENV})`);
  console.info(`[worker] core wired: hostnameKey -> ${hostnameKey("https://www.example.com/x")}`);

  try {
    await db.execute(sql`select 1`);
    console.info("[worker] database reachable");
  } catch (error) {
    console.error("[worker] database not reachable (continuing):", error);
  }

  // Keep the process alive until pg-boss owns the lifecycle (Epic 4).
  const heartbeat = setInterval(() => {
    console.info("[worker] heartbeat");
  }, 60_000);

  const shutdown = (signal: string) => {
    console.info(`[worker] ${signal} received, shutting down`);
    clearInterval(heartbeat);
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error("[worker] fatal:", error);
  process.exit(1);
});
