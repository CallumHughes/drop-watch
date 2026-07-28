import type { APIRequestContext } from "@playwright/test";

import { FIXTURE_URL, SINK_WEBHOOK_ID } from "../../constants";

/**
 * The shape the app POSTs to a Home Assistant webhook — mirrored from
 * `NotificationPayload` in packages/core/src/notify/index.ts, reduced to the
 * fields the specs assert on.
 */
export interface AlertPayload {
  pctChange: string | null;
  previousPrice: string | null;
  price: string | null;
  productId: string;
  rule: string;
  title: string | null;
  url: string;
}

/**
 * Reads what the fixture server's webhook sink has received. The sink is
 * shared by every test (one settings row, one webhook id), so consumers always
 * filter by their own product's URL — never assert on the sink as a whole.
 */
export class WebhookSink {
  private readonly request: APIRequestContext;

  constructor(request: APIRequestContext) {
    this.request = request;
  }

  async payloads(): Promise<AlertPayload[]> {
    const response = await this.request.get(`${FIXTURE_URL}/__webhooks/${SINK_WEBHOOK_ID}`);
    if (!response.ok()) {
      throw new Error(`webhook sink read failed: HTTP ${response.status()}`);
    }
    return (await response.json()) as AlertPayload[];
  }

  /** Alerts for one product page, oldest first. */
  async alertsFor(productUrl: string): Promise<AlertPayload[]> {
    const all = await this.payloads();
    return all.filter((payload) => payload.url === productUrl);
  }
}
