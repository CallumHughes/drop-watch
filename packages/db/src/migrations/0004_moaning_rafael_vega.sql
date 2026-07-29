CREATE TABLE "invitation" (
	"accepted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"email" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"invited_by" text NOT NULL,
	"token_hash" text NOT NULL,
	CONSTRAINT "invitation_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "impersonated_by" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_expires" timestamp;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "banned" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_reason" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
UPDATE "user" SET "role" = 'admin' WHERE "role" IS NULL;