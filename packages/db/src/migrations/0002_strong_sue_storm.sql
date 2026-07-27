CREATE TABLE "settings" (
	"alerts_enabled" boolean DEFAULT true NOT NULL,
	"cooldown_minutes" integer DEFAULT 720 NOT NULL,
	"failure_threshold" integer DEFAULT 5 NOT NULL,
	"ha_url" text,
	"ha_webhook_id" text,
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_singleton" CHECK ("settings"."id" = 1)
);
