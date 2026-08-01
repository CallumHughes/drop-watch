/**
 * The settings router's input schema, in a module with no server imports.
 *
 * The router (`../routers/settings`) validates with this; the admin settings
 * form imports the same bounds for its native `min`/`max` attributes, so the
 * browser and the server reject exactly the same values. That sharing is why
 * this file exists: the router itself pulls in the database, which a client
 * bundle must never do.
 */

import { z } from "zod";

/** An hour is the shortest quiet period that is still quiet. */
export const MIN_COOLDOWN_MINUTES = 60;
/** A week. Longer than this and you have switched the rule off, not tuned it. */
export const MAX_COOLDOWN_MINUTES = 10_080;
export const MIN_FAILURE_THRESHOLD = 2;
export const MAX_FAILURE_THRESHOLD = 50;
export const MAX_WEBHOOK_ID_LENGTH = 200;
export const MAX_URL_LENGTH = 2048;
export const MAX_TOKEN_LENGTH = 500;

/**
 * BotFather's shape: numeric bot id, colon, base64ish secret. Anything else
 * would be interpolated into the Bot API URL path, so it is rejected here.
 */
export const TELEGRAM_BOT_TOKEN_PATTERN = /^\d+:[\w-]+$/;

/**
 * All channel fields are nullable so the page can clear them, which is
 * how you turn a channel off without also losing the cooldown you tuned.
 */
export const settingsUpdateInput = z.object({
  alertsEnabled: z.boolean().optional(),
  cooldownMinutes: z.number().int().min(MIN_COOLDOWN_MINUTES).max(MAX_COOLDOWN_MINUTES).optional(),
  discordWebhookUrl: z.url().max(MAX_URL_LENGTH).nullable().optional(),
  failureThreshold: z
    .number()
    .int()
    .min(MIN_FAILURE_THRESHOLD)
    .max(MAX_FAILURE_THRESHOLD)
    .optional(),
  haUrl: z.url().max(MAX_URL_LENGTH).nullable().optional(),
  haWebhookId: z.string().min(1).max(MAX_WEBHOOK_ID_LENGTH).nullable().optional(),
  ntfyToken: z.string().trim().min(1).max(MAX_TOKEN_LENGTH).nullable().optional(),
  ntfyUrl: z.url().max(MAX_URL_LENGTH).nullable().optional(),
  telegramBotToken: z
    .string()
    .trim()
    .max(MAX_TOKEN_LENGTH)
    .regex(TELEGRAM_BOT_TOKEN_PATTERN, "Not a Telegram bot token")
    .nullable()
    .optional(),
  telegramChatId: z.string().trim().min(1).max(MAX_TOKEN_LENGTH).nullable().optional(),
});

export type SettingsUpdateInput = z.infer<typeof settingsUpdateInput>;
