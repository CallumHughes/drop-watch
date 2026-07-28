import type { APIRequestContext } from "@playwright/test";

import { FIXTURE_URL } from "../../constants";

/**
 * What the Resend SDK POSTs to `/emails` — mirrored from the fields
 * `sendEmail` in packages/email/src/client.ts sends, reduced to what the
 * specs assert on.
 */
export interface CapturedEmail {
  from: string;
  html: string;
  subject: string;
  text: string;
  to: string[];
}

/**
 * Reads what the fixture server's fake Resend API has received. The sink is
 * shared by every test — the worker emails every alert once email alerting is
 * on — so consumers always filter by their own product's title or by subject,
 * never assert on the sink as a whole.
 */
export class EmailSink {
  private readonly request: APIRequestContext;

  constructor(request: APIRequestContext) {
    this.request = request;
  }

  async messages(): Promise<CapturedEmail[]> {
    const response = await this.request.get(`${FIXTURE_URL}/__emails`);
    if (!response.ok()) {
      throw new Error(`email sink read failed: HTTP ${response.status()}`);
    }
    return (await response.json()) as CapturedEmail[];
  }

  /** Mails whose subject matches, oldest first. */
  async messagesWithSubject(pattern: RegExp): Promise<CapturedEmail[]> {
    const all = await this.messages();
    return all.filter((message) => pattern.test(message.subject));
  }
}

/**
 * The one-time link inside a transactional mail, found by the API path Better
 * Auth routes it through (e.g. `/api/auth/verify-email`).
 *
 * The text part is searched before the HTML part because the plain-text render
 * carries the URL verbatim, while HTML escapes `&` in the query string — which
 * is why the match is unescaped before being returned.
 */
export function extractAuthLink(email: CapturedEmail, apiPath: string): string {
  const urls = `${email.text}\n${email.html}`.match(/https?:\/\/[^\s\]"'<>)]+/g) ?? [];
  const link = urls.find((url) => url.includes(apiPath));
  if (!link) {
    throw new Error(`no link containing ${apiPath} in mail "${email.subject}"`);
  }
  return link.replace(/&amp;/g, "&");
}
