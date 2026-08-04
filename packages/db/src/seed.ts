/**
 * Seeds a fresh database: the single admin user Better Auth signs in, plus a
 * handful of products (and their listings) for the worker to chew on.
 *
 * Idempotent — re-running it inserts nothing new and never overwrites a price
 * history. Run with `pnpm --filter @drop-watch/db db:seed`.
 */

import { randomUUID } from "node:crypto";

import { env } from "@drop-watch/env/seed";
import { hashPassword } from "better-auth/crypto";
import { and, eq, sql } from "drizzle-orm";

import { createDb } from "./index";
import { account, user } from "./schema/auth";
import { listings, type NewListing, type NewProduct, products } from "./schema/products";

interface SeedEntry {
  listings: Omit<NewListing, "productId" | "userId">[];
  product: Omit<NewProduct, "userId">;
}

/**
 * Stable, scraping-friendly product pages. The first three carry schema.org
 * JSON-LD; books.toscrape.com carries none, so it exercises the configured
 * selector path. All four were verified live against the Epic 2 extractor.
 * Ownerless here — every seed row is stamped with the admin's id at insert
 * time, since products (and listings) are per-user.
 */
const SEED_ENTRIES: SeedEntry[] = [
  {
    listings: [
      // A second store joins once product-level series are windowed per
      // listing — until then two stores interleave into one nonsense series.
      {
        intervalMinutes: 180,
        url: "https://scrapeme.live/shop/Bulbasaur/",
      },
    ],
    product: {
      currency: "GBP",
      dropPercent: 10,
      rules: ["target", "drop_percent"],
      targetPrice: "60.00",
      title: "Bulbasaur",
    },
  },
  {
    listings: [
      {
        intervalMinutes: 360,
        url: "https://www.scrapingcourse.com/ecommerce/product/abominable-hoodie/",
      },
    ],
    product: {
      currency: "USD",
      // Listed out of stock, which makes it the useful one for restock alerts.
      rules: ["restock", "target"],
      targetPrice: "50.00",
      title: "Abominable Hoodie",
    },
  },
  {
    listings: [
      {
        intervalMinutes: 720,
        url: "https://www.ikea.com/gb/en/p/billy-bookcase-white-00263850/",
      },
    ],
    product: {
      currency: "GBP",
      dropPercent: 15,
      rules: ["drop_percent"],
      title: "BILLY Bookcase - white 80x28x202 cm",
    },
  },
  {
    listings: [
      {
        // No structured data on this page at all — the selector chain is the point.
        extractor: "selector",
        intervalMinutes: 1440,
        selector: "p.price_color",
        url: "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html",
      },
    ],
    product: {
      currency: "GBP",
      rules: ["target"],
      targetPrice: "45.00",
      title: "A Light in the Attic",
    },
  },
];

/** Returns the admin's user id — the products seeded below belong to it. */
async function seedAdmin(db: ReturnType<typeof createDb>): Promise<{ id: string; note: string }> {
  const email = env.SEED_ADMIN_EMAIL.toLowerCase();
  const [found] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  if (found) {
    return { id: found.id, note: `admin ${email} already exists (${found.id})` };
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

  return { id, note: `admin ${email} created (${id})` };
}

async function seedEntry(
  db: ReturnType<typeof createDb>,
  adminId: string,
  entry: SeedEntry
): Promise<boolean> {
  const firstUrl = entry.listings[0]?.url;
  if (!firstUrl) {
    return false;
  }

  // Re-seeding must not duplicate a product: a listing at this URL for this
  // user existing already means the whole entry was seeded before.
  const [existing] = await db
    .select({ id: listings.id })
    .from(listings)
    .where(and(eq(listings.userId, adminId), eq(listings.url, firstUrl)));
  if (existing) {
    return false;
  }

  const [product] = await db
    .insert(products)
    .values({ ...entry.product, userId: adminId })
    .returning({ id: products.id });
  if (!product) {
    return false;
  }

  await db
    .insert(listings)
    .values(
      entry.listings.map((listing) => ({ ...listing, productId: product.id, userId: adminId }))
    )
    .onConflictDoNothing({ target: [listings.userId, listings.url] });

  return true;
}

async function seedProducts(db: ReturnType<typeof createDb>, adminId: string): Promise<string> {
  let insertedCount = 0;
  for (const entry of SEED_ENTRIES) {
    // biome-ignore lint/performance/noAwaitInLoops: each entry's skip check depends on the previous inserts.
    const inserted = await seedEntry(db, adminId, entry);
    if (inserted) {
      insertedCount += 1;
    }
  }

  const [total] = await db.select({ count: sql<number>`count(*)::int` }).from(products);
  return `products: ${insertedCount} inserted, ${total?.count ?? 0} total`;
}

async function main() {
  const db = createDb();
  const admin = await seedAdmin(db);
  process.stdout.write(`${admin.note}\n`);
  process.stdout.write(`${await seedProducts(db, admin.id)}\n`);
  await db.$client.end();
}

main().catch((error: unknown) => {
  process.stderr.write(`seed failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
