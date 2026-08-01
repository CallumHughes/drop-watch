/**
 * ntfy, Discord and Telegram: three single-POST channels sharing
 * `sendNotification`'s contract from `./index` — 5s budget, drained body,
 * never throws — but not its code, since each has a different wire shape.
 */

import { request } from "undici";

import type { AlertChannel, ChannelSendResult } from "./channels";
import { alertMessage } from "./message";

const DEFAULT_TIMEOUT_MS = 5000;
const HTTP_BAD_REQUEST = 400;

/** HTTP headers are Latin-1; anything outside printable ASCII becomes `?`. */
function asciiSafe(text: string): string {
  return text.replace(/[^\x20-\x7e]/g, "?");
}

async function post(
  url: string,
  body: string,
  headers: Record<string, string>,
  errorLabel: string
): Promise<ChannelSendResult> {
  try {
    const response = await request(url, {
      body,
      bodyTimeout: DEFAULT_TIMEOUT_MS,
      headers,
      headersTimeout: DEFAULT_TIMEOUT_MS,
      method: "POST",
    });
    await response.body.dump();
    if (response.statusCode >= HTTP_BAD_REQUEST) {
      return {
        error: `${errorLabel} returned HTTP ${response.statusCode}`,
        httpStatus: response.statusCode,
        ok: false,
      };
    }
    return { httpStatus: response.statusCode, ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), ok: false };
  }
}

export interface NtfyConfig {
  /** Bearer token for a protected topic, or `null` for a public one. */
  token: string | null;
  /** The full topic URL, e.g. `https://ntfy.sh/my-topic`. */
  url: string;
}

/** POSTs the message body to an ntfy topic; the title rides in a header. */
export function ntfyChannel(config: NtfyConfig): AlertChannel {
  return {
    name: "ntfy",
    send: (payload) => {
      const { body, title } = alertMessage(payload);
      const headers: Record<string, string> = {
        "content-type": "text/plain; charset=utf-8",
        title: asciiSafe(title),
      };
      if (config.token) {
        headers.authorization = `Bearer ${config.token}`;
      }
      return post(config.url, body, headers, "ntfy");
    },
    target: config.url,
  };
}

/** POSTs `{ content }` to a Discord webhook URL. */
export function discordChannel(webhookUrl: string): AlertChannel {
  return {
    name: "discord",
    send: (payload) => {
      const { body, title } = alertMessage(payload);
      // Titles are scraped from remote pages; never let one ping @everyone.
      return post(
        webhookUrl,
        JSON.stringify({
          allowed_mentions: { parse: [] },
          content: `**${title}**\n${body}`,
        }),
        { "content-type": "application/json" },
        "Discord"
      );
    },
    target: webhookUrl,
  };
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

/** POSTs to the Bot API's `sendMessage`. The bot token stays out of `target`. */
export function telegramChannel(config: TelegramConfig): AlertChannel {
  return {
    name: "telegram",
    send: (payload) => {
      const { body, title } = alertMessage(payload);
      return post(
        `https://api.telegram.org/bot${config.botToken}/sendMessage`,
        JSON.stringify({ chat_id: config.chatId, text: `${title}\n${body}` }),
        { "content-type": "application/json" },
        "Telegram"
      );
    },
    // Never the bot token — it's the credential, not the destination.
    target: `telegram:${config.chatId}`,
  };
}
