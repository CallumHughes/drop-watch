/**
 * Template rendering.
 *
 * These are pure: a payload in, a string of HTML out, no network and no
 * mocking library — the same rule the rest of the repo follows (see
 * `packages/core/src/rules/index.test.ts`, and `notify/index.test.ts`, which
 * stands up a real `node:http` server rather than intercepting undici). The
 * Resend transport is deliberately not tested here; it is thin orchestration
 * over someone else's HTTP client, in the same category as `alerting.ts`.
 *
 * What is worth asserting is what a person actually receives: the price, the
 * title and the link. The price assertions double as the regression test for
 * the rule that matters most — money is a decimal string end to end, so
 * `55.44` must reach the inbox as `£55.44` and never as `55.440000000000005`.
 */

/** @jsxRuntime automatic — see ./layout.tsx for why every template declares it. */
/** @jsxImportSource react */

import type { NotificationPayload } from "@drop-watch/core/notify";
import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";

import { ChangeEmail } from "./change-email";
import { Invite } from "./invite";
import { PriceAlert, priceAlertSubject } from "./price-alert";
import { ResetPassword } from "./reset-password";
import { TrackerBroken, trackerBrokenSubject } from "./tracker-broken";
import { VerifyEmail } from "./verify-email";

const TRACKER_URL = "http://tracker.local/products/8a2652d2-cf09-40c9-a6eb-69443792f784";

/** A target-hit alert, every field populated as the worker populates them. */
const alert: NotificationPayload = {
  consecutiveFailures: null,
  currency: "GBP",
  error: null,
  imageUrl: null,
  inStock: true,
  pctChange: "-12.0",
  previousPrice: "63.00",
  price: "55.44",
  productId: "8a2652d2-cf09-40c9-a6eb-69443792f784",
  rule: "target",
  title: "Bulbasaur",
  url: "https://scrapeme.live/shop/Bulbasaur/",
};

const broken: NotificationPayload = {
  consecutiveFailures: 5,
  currency: null,
  error: "no price found on the page",
  imageUrl: null,
  inStock: null,
  pctChange: null,
  previousPrice: null,
  price: null,
  productId: "8a2652d2-cf09-40c9-a6eb-69443792f784",
  rule: "tracker_broken",
  title: "Bulbasaur",
  url: "https://scrapeme.live/shop/Bulbasaur/",
};

describe("PriceAlert", () => {
  it("renders the price exactly, from the decimal string", async () => {
    const html = await render(<PriceAlert payload={alert} trackerUrl={TRACKER_URL} />);

    expect(html).toContain("£55.44");
    expect(html).toContain("£63.00");
    expect(html).toContain("Bulbasaur");
  });

  it("links to the tracker and to the shop", async () => {
    const html = await render(<PriceAlert payload={alert} trackerUrl={TRACKER_URL} />);

    expect(html).toContain(TRACKER_URL);
    expect(html).toContain("https://scrapeme.live/shop/Bulbasaur/");
  });

  it("falls back to the shop link when APP_URL is unset", async () => {
    const html = await render(<PriceAlert payload={alert} trackerUrl={null} />);

    expect(html).toContain("https://scrapeme.live/shop/Bulbasaur/");
    expect(html).not.toContain("tracker.local");
  });

  it("renders a price with no currency as the bare digits", async () => {
    const html = await render(
      <PriceAlert payload={{ ...alert, currency: null }} trackerUrl={null} />
    );

    expect(html).toContain("55.44");
  });

  it("omits the price block entirely on a restock with no price", async () => {
    const restock: NotificationPayload = {
      ...alert,
      pctChange: null,
      previousPrice: null,
      price: null,
      rule: "restock",
    };
    const html = await render(<PriceAlert payload={restock} trackerUrl={null} />);

    expect(html).toContain("back in stock");
    expect(html).not.toContain("£");
  });

  it("names the host when extraction never found a title", async () => {
    const html = await render(<PriceAlert payload={{ ...alert, title: null }} trackerUrl={null} />);

    expect(html).toContain("scrapeme.live");
  });

  it("renders to plain text as well as HTML", async () => {
    const text = await render(<PriceAlert payload={alert} trackerUrl={TRACKER_URL} />, {
      plainText: true,
    });

    expect(text).toContain("£55.44");
    expect(text).not.toContain("<html");
  });
});

describe("priceAlertSubject", () => {
  it("leads with the outcome and the new price", () => {
    expect(priceAlertSubject(alert)).toBe("Target hit: Bulbasaur at £55.44");
  });

  it("carries the percentage on a drop", () => {
    expect(priceAlertSubject({ ...alert, rule: "drop_percent" })).toBe(
      "Price drop -12.0%: Bulbasaur now £55.44"
    );
  });

  it("says only that stock is back when that is the news", () => {
    expect(priceAlertSubject({ ...alert, rule: "restock" })).toBe("Back in stock: Bulbasaur");
  });

  it("labels a test send as one", () => {
    expect(priceAlertSubject({ ...alert, rule: "test" })).toBe("Test alert from Price Tracker");
  });
});

describe("TrackerBroken", () => {
  it("reports the failure streak and the error text", async () => {
    const html = await render(<TrackerBroken payload={broken} trackerUrl={TRACKER_URL} />);

    expect(html).toContain("5 checks");
    expect(html).toContain("no price found on the page");
    expect(html).toContain(TRACKER_URL);
  });

  it("names the product in the subject", () => {
    expect(trackerBrokenSubject(broken)).toBe("Tracker broken: Bulbasaur");
  });
});

describe("auth templates", () => {
  const url = "http://tracker.local/api/auth/verify-email?token=abc123";

  it("renders the verification link as a button and as raw text", async () => {
    const html = await render(<VerifyEmail url={url} />);

    // Twice: once in the button's href, once as copyable text, because a
    // link that cannot be clicked has to be copyable or the account is locked.
    expect(html.split(url).length - 1).toBeGreaterThanOrEqual(2);
  });

  it("renders the reset link", async () => {
    const html = await render(<ResetPassword url={url} />);

    expect(html).toContain(url);
    expect(html).toContain("Choose a new password");
  });

  it("shows the new address on a change-email approval without linking it", async () => {
    const html = await render(<ChangeEmail newEmail="new@example.com" url={url} />);

    expect(html).toContain("new@example.com");
    expect(html).not.toContain("mailto:new@example.com");
    expect(html).toContain(url);
  });
});

describe("Invite", () => {
  const url = "http://tracker.local/invite/abc123";

  it("renders the invite link as a button and as raw text", async () => {
    const html = await render(<Invite url={url} />);

    // Twice, like the verification mail: the link is the only way to an
    // account, so it has to survive clients that strip the button.
    expect(html.split(url).length - 1).toBeGreaterThanOrEqual(2);
    expect(html).toContain("48 hours");
  });
});
