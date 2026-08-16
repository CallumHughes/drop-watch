ALTER TABLE "listings" ALTER COLUMN "extractor" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "listings" ALTER COLUMN "extractor" SET DEFAULT 'auto';--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "expression" text;--> statement-breakpoint
UPDATE "listings" SET "expression" = "selector" WHERE "selector" IS NOT NULL;--> statement-breakpoint
DROP TYPE "public"."extractor_mode";