CREATE TYPE "public"."check_run_status" AS ENUM('ok', 'extract_failed', 'http_error', 'network_error', 'timeout');--> statement-breakpoint
CREATE TYPE "public"."extractor_mode" AS ENUM('auto', 'selector');--> statement-breakpoint
CREATE TYPE "public"."render_mode" AS ENUM('http', 'browser');--> statement-breakpoint
CREATE TABLE "alert_state" (
	"last_alerted_at" timestamp with time zone,
	"last_alerted_price" numeric(12, 2),
	"product_id" uuid NOT NULL,
	"rule" text NOT NULL,
	CONSTRAINT "alert_state_product_id_rule_pk" PRIMARY KEY("product_id","rule")
);
--> statement-breakpoint
CREATE TABLE "check_runs" (
	"duration_ms" integer,
	"error" text,
	"extractor_used" text,
	"http_status" integer,
	"id" bigserial PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "check_run_status" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_points" (
	"availability" text,
	"currency" char(3) NOT NULL,
	"id" bigserial PRIMARY KEY NOT NULL,
	"in_stock" boolean,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"product_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"currency" char(3),
	"drop_percent" integer,
	"etag" text,
	"extractor" "extractor_mode" DEFAULT 'auto' NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"image_url" text,
	"interval_minutes" integer DEFAULT 180 NOT NULL,
	"jitter_percent" integer DEFAULT 20 NOT NULL,
	"last_modified" text,
	"locale" text,
	"next_check_at" timestamp with time zone DEFAULT now() NOT NULL,
	"render" "render_mode" DEFAULT 'http' NOT NULL,
	"rules" text[] DEFAULT '{}'::text[] NOT NULL,
	"selector" text,
	"target_price" numeric(12, 2),
	"title" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"url" text NOT NULL,
	CONSTRAINT "products_url_unique" UNIQUE("url")
);
--> statement-breakpoint
ALTER TABLE "alert_state" ADD CONSTRAINT "alert_state_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_runs" ADD CONSTRAINT "check_runs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_points" ADD CONSTRAINT "price_points_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "check_runs_product_id_started_at_idx" ON "check_runs" USING btree ("product_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "price_points_product_id_observed_at_idx" ON "price_points" USING btree ("product_id","observed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "products_active_next_check_at_idx" ON "products" USING btree ("active","next_check_at");