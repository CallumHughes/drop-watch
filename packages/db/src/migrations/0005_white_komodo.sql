ALTER TABLE "user" ADD COLUMN "email_alerts_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Carry the instance-wide toggle onto every existing account: before this
-- migration, "email alerts on" meant every verified account was mailed, so
-- every existing account keeps the behaviour it had. Must run before the
-- settings column below is dropped.
UPDATE "user" SET "email_alerts_enabled" = COALESCE((SELECT "email_alerts_enabled" FROM "settings" WHERE "id" = 1), false);--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "email_alerts_enabled";--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "user_id" text;--> statement-breakpoint
-- Existing installs are single-user: everything belongs to the (earliest)
-- admin, falling back to the earliest user for safety. Same backfill pattern
-- as 0004's role stamp. If products exist but no users at all, the SET NOT
-- NULL below fails loudly — preferable to guessing an owner.
UPDATE "products" SET "user_id" = COALESCE(
  (SELECT "id" FROM "user" WHERE "role" = 'admin' ORDER BY "created_at" ASC LIMIT 1),
  (SELECT "id" FROM "user" ORDER BY "created_at" ASC LIMIT 1)
);--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_url_unique";--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_user_id_url_unique" UNIQUE("user_id","url");
