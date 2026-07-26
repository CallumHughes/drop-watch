import { env } from "@price-tracker/env/server";
import { drizzle } from "drizzle-orm/node-postgres";

// biome-ignore lint/performance/noNamespaceImport: drizzle requires the full schema object.
import * as schema from "./schema/auth";

export function createDb() {
  return drizzle(env.DATABASE_URL, { schema });
}

export const db = createDb();
