/**
 * Seeds a fresh database: the single admin user Better Auth signs in, plus a
 * handful of products for the worker to chew on.
 *
 * Idempotent — re-running it inserts nothing new and never overwrites a price
 * history. Run with `pnpm --filter @price-tracker/db db:seed`.
 */

import { randomUUID } from "node:crypto";

import { env } from "@price-tracker/env/seed";
import { hashPassword } from "better-auth/crypto";
import { eq, sql } from "drizzle-orm";

import { createDb } from "./index";
import { account, user } from "./schema/auth";
import { type NewProduct, products } from "./schema/products";

/**
 * Stable, scraping-friendly product pages. The first three carry schema.org
 * JSON-LD; books.toscrape.com carries none, so it exercises the configured
 * selector path. All four were verified live against the Epic 2 extractor.
 */
const SEED_PRODUCTS: NewProduct[] = [
  {
    currency: "GBP",
    dropPercent: 10,
    intervalMinutes: 180,
    rules: ["target", "drop_percent"],
    targetPrice: "60.00",
    title: "Bulbasaur",
    url: "https://scrapeme.live/shop/Bulbasaur/",
  },
  {
    currency: "USD",
    // Listed out of stock, which makes it the useful one for restock alerts.
    intervalMinutes: 360,
    rules: ["restock", "target"],
    targetPrice: "50.00",
    title: "Abominable Hoodie",
    url: "https://www.scrapingcourse.com/ecommerce/product/abominable-hoodie/",
  },
  {
    currency: "GBP",
    dropPercent: 15,
    intervalMinutes: 720,
    rules: ["drop_percent"],
    title: "BILLY Bookcase - white 80x28x202 cm",
    url: "https://www.ikea.com/gb/en/p/billy-bookcase-white-00263850/",
  },
  {
    currency: "GBP",
    // No structured data on this page at all — the selector chain is the point.
    extractor: "selector",
    intervalMinutes: 1440,
    rules: ["target"],
    selector: "p.price_color",
    targetPrice: "45.00",
    title: "A Light in the Attic",
    url: "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html",
  },
];

async function seedAdmin(db: ReturnType<typeof createDb>): Promise<string> {
  const email = env.SEED_ADMIN_EMAIL.toLowerCase();
  const [found] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  if (found) {
    return `admin ${email} already exists (${found.id})`;
  }

  const id = randomUUID();
  const now = new Date();
  await db.insert(user).values({
    createdAt: now,
    email,
    emailVerified: true,
    id,
    name: env.SEED_ADMIN_NAME,
    role: "admin",
    updatedAt: now,
  });

  // Better Auth stores credential passwords on the linked account row, under
  // providerId "credential" with accountId equal to the user id.
  await db.insert(account).values({
    accountId: id,
    createdAt: now,
    id: randomUUID(),
    password: await hashPassword(env.SEED_ADMIN_PASSWORD),
    providerId: "credential",
    updatedAt: now,
    userId: id,
  });

  return `admin ${email} created (${id})`;
}

async function seedProducts(db: ReturnType<typeof createDb>): Promise<string> {
  const inserted = await db
    .insert(products)
    .values(SEED_PRODUCTS)
    // `url` is unique; re-seeding must not disturb an already-tracked product.
    .onConflictDoNothing({ target: products.url })
    .returning({ id: products.id, url: products.url });

  const [total] = await db.select({ count: sql<number>`count(*)::int` }).from(products);
  return `products: ${inserted.length} inserted, ${total?.count ?? 0} total`;
}

async function main() {
  const db = createDb();
  process.stdout.write(`${await seedAdmin(db)}\n`);
  process.stdout.write(`${await seedProducts(db)}\n`);
  await db.$client.end();
}

main().catch((error: unknown) => {
  process.stderr.write(`seed failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
