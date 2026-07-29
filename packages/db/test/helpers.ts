/**
 * Shared plumbing for the integration suites. Everything here goes through the
 * same `db` singleton the code under test uses — the suites exercise the real
 * module graph, not a parallel connection.
 */

import { sql } from "drizzle-orm";

import { db } from "../src/index";
import { user } from "../src/schema/auth";
import { settings } from "../src/schema/settings";

/**
 * Ends the singleton's pool. Every suite that imports from `src` must call
 * this in `afterAll`, or the forked test process never exits.
 */
export async function closeDb(): Promise<void> {
  await db.$client.end();
}

/** Cascades to `session` and `account` via their FKs. */
export async function truncateUsers(): Promise<void> {
  await db.execute(sql`TRUNCATE "user" RESTART IDENTITY CASCADE`);
}

export async function resetSettings(): Promise<void> {
  await db.delete(settings);
}

export interface TestUser {
  email: string;
  emailVerified?: boolean;
  name?: string;
}

export async function insertUser({
  email,
  emailVerified = false,
  name = "Test User",
}: TestUser): Promise<void> {
  await db.insert(user).values({ email, emailVerified, id: crypto.randomUUID(), name });
}
