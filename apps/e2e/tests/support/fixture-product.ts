import { randomUUID } from "node:crypto";

import type { APIRequestContext } from "@playwright/test";

import { FIXTURE_URL } from "../../constants";
import type { FixtureProductState } from "../../fixture-server/templates";

const DEFAULTS: Omit<FixtureProductState, "title"> = {
  availability: "InStock",
  currency: "GBP",
  price: "100.00",
  template: "jsonld",
};

/**
 * One test's own product page on the fixture server.
 *
 * The slug (and so the URL and title) is unique per instantiation, which is
 * the entire isolation model of the parallel suite: no two tests ever share a
 * product URL, a dashboard card title, or an alert payload.
 */
export class FixtureProduct {
  readonly slug: string;
  readonly title: string;
  private state: FixtureProductState;
  private readonly request: APIRequestContext;

  constructor(request: APIRequestContext) {
    this.request = request;
    this.slug = `e2e-${randomUUID()}`;
    this.title = `E2E Widget ${this.slug}`;
    this.state = { ...DEFAULTS, title: this.title };
  }

  /** The URL the app scrapes — what gets pasted into the add-product form. */
  get url(): string {
    return `${FIXTURE_URL}/products/${this.slug}`;
  }

  get price(): string {
    return this.state.price;
  }

  /** Registers (or re-registers) the page on the fixture server. */
  async publish(overrides: Partial<FixtureProductState> = {}): Promise<void> {
    this.state = { ...this.state, ...overrides };
    const response = await this.request.put(`${FIXTURE_URL}/__products/${this.slug}`, {
      data: this.state,
    });
    if (!response.ok()) {
      throw new Error(`fixture product registration failed: HTTP ${response.status()}`);
    }
  }

  /** Changes the advertised price; the next check observes it. */
  async setPrice(price: string): Promise<void> {
    await this.publish({ price });
  }
}
