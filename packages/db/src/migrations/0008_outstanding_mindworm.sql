CREATE TABLE "listings" (
	"active" boolean DEFAULT true NOT NULL,
	"broken_reported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"currency" char(3),
	"etag" text,
	"extractor" "extractor_mode" DEFAULT 'auto' NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"interval_minutes" integer DEFAULT 180 NOT NULL,
	"jitter_percent" integer DEFAULT 20 NOT NULL,
	"last_modified" text,
	"locale" text,
	"next_check_at" timestamp with time zone DEFAULT now() NOT NULL,
	"product_id" uuid NOT NULL,
	"render" "render_mode" DEFAULT 'http' NOT NULL,
	"selector" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"url" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "listings_user_id_url_unique" UNIQUE("user_id","url")
);
--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_user_id_url_unique";--> statement-breakpoint
ALTER TABLE "check_runs" DROP CONSTRAINT "check_runs_product_id_products_id_fk";
--> statement-breakpoint
ALTER TABLE "price_points" DROP CONSTRAINT "price_points_product_id_products_id_fk";
--> statement-breakpoint
DROP INDEX "check_runs_product_id_started_at_idx";--> statement-breakpoint
DROP INDEX "price_points_product_id_observed_at_idx";--> statement-breakpoint
DROP INDEX "products_active_next_check_at_idx";--> statement-breakpoint
ALTER TABLE "check_runs" ADD COLUMN "listing_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "price_points" ADD COLUMN "listing_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listings_active_next_check_at_idx" ON "listings" USING btree ("active","next_check_at");--> statement-breakpoint
CREATE INDEX "listings_product_id_idx" ON "listings" USING btree ("product_id");--> statement-breakpoint
ALTER TABLE "check_runs" ADD CONSTRAINT "check_runs_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_points" ADD CONSTRAINT "price_points_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "check_runs_listing_id_started_at_idx" ON "check_runs" USING btree ("listing_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "price_points_listing_id_observed_at_idx" ON "price_points" USING btree ("listing_id","observed_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "check_runs" DROP COLUMN "product_id";--> statement-breakpoint
ALTER TABLE "price_points" DROP COLUMN "product_id";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "etag";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "extractor";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "interval_minutes";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "jitter_percent";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "last_modified";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "locale";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "next_check_at";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "render";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "selector";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "url";