import { randomUUID } from "node:crypto";

import type { APIRequestContext } from "@playwright/test";

import { FIXTURE_URL, fixtureOrigin } from "../../constants";
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
 *
 * The *host* is per worker rather than per product, and that is deliberate on
 * both counts: it is what stops workers queueing behind one another in the
 * app's per-domain fetch queue (see `FIXTURE_HOSTS`), while two products of
 * one test still share a host — which is the case the product page's chart
 * legend disambiguates, and so the case `multi-listing.spec.ts` covers.
 */
export class FixtureProduct {
  /** The host this worker scrapes, as the app labels it in the UI. */
  readonly host: string;
  readonly slug: string;
  readonly title: string;
  private readonly origin: string;
  private state: FixtureProductState;
  private readonly request: APIRequestContext;

  constructor(request: APIRequestContext, parallelIndex: number) {
    this.request = request;
    this.origin = fixtureOrigin(parallelIndex);
    this.host = new URL(this.origin).hostname;
    this.slug = `e2e-${randomUUID()}`;
    this.title = `E2E Widget ${this.slug}`;
    this.state = { ...DEFAULTS, title: this.title };
  }

  /** The URL the app scrapes — what gets pasted into the add-product form. */
  get url(): string {
    return `${this.origin}/products/${this.slug}`;
  }

  get price(): string {
    return this.state.price;
  }

  /**
   * Registers (or re-registers) the page on the fixture server. Addressed as
   * `localhost`, not as this worker's host: the server's state is one map
   * shared by every name, and only the URL the *app* fetches needs to vary.
   */
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
