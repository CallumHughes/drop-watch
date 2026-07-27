import { env } from "@price-tracker/env/db";
import { drizzle } from "drizzle-orm/node-postgres";

// biome-ignore lint/performance/noNamespaceImport: drizzle requires the full schema object.
import * as schema from "./schema/auth";

export function createDb() {
  return drizzle(env.DATABASE_URL, { schema });
}

// Reuse one pool across Next.js dev hot reloads; a fresh pool per reload
// exhausts Postgres connections.
const globalForDb = globalThis as { __priceTrackerDb?: ReturnType<typeof createDb> };

export const db = globalForDb.__priceTrackerDb ?? createDb();

if (env.NODE_ENV !== "production") {
  globalForDb.__priceTrackerDb = db;
}
