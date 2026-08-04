/**
 * Message formatting. No HTTP here — {@link alertMessage} is pure, so these
 * assert on the strings a push notification would actually show.
 */

import { describe, expect, it } from "vitest";

import type { NotificationPayload } from "./index";
import { alertMessage } from "./message";

const base: NotificationPayload = {
  consecutiveFailures: null,
  currency: "GBP",
  error: null,
  imageUrl: null,
  inStock: true,
  listingId: "9e6a1a3c-2f0e-4a9b-8c3d-1f2e3a4b5c6d",
  pctChange: "-12.0",
  previousPrice: "63.00",
  price: "55.44",
  productId: "8a2652d2-cf09-40c9-a6eb-69443792f784",
  rule: "target",
  title: "Bulbasaur",
  url: "https://scrapeme.live/shop/Bulbasaur/",
};

describe("alertMessage", () => {
  it("titles a target alert with the product label and the store", () => {
    const message = alertMessage(base);
    expect(message.title).toBe("Target hit: Bulbasaur at scrapeme.live");
  });

  it("strips a leading www. from the store name", () => {
    const message = alertMessage({ ...base, url: "https://www.scrapeme.live/shop/Bulbasaur/" });
    expect(message.title).toBe("Target hit: Bulbasaur at scrapeme.live");
  });

  it("formats price, previous price and percent change without going through Number", () => {
    const message = alertMessage(base);
    expect(message.body).toContain("£55.44 (was £63.00)");
    expect(message.body).toContain("-12.0%");
    expect(message.body).toContain(base.url);
  });

  it("falls back to the hostname when there is no title, without repeating it", () => {
    const message = alertMessage({ ...base, title: null, url: "https://www.example.com/x" });
    expect(message.title).toBe("Target hit: example.com");
  });

  it("titles a drop_percent alert", () => {
    const message = alertMessage({ ...base, rule: "drop_percent" });
    expect(message.title).toBe("Price drop: Bulbasaur at scrapeme.live");
  });

  it("titles a restock alert", () => {
    const message = alertMessage({ ...base, rule: "restock" });
    expect(message.title).toBe("Back in stock: Bulbasaur at scrapeme.live");
  });

  it("describes a watch_broken alert by its failure count and error", () => {
    const message = alertMessage({
      ...base,
      consecutiveFailures: 5,
      error: "selector not found",
      rule: "watch_broken",
    });
    expect(message.title).toBe("Watch broken: Bulbasaur at scrapeme.live");
    expect(message.body).toContain("The last 5 checks failed in a row.");
    expect(message.body).toContain("selector not found");
  });

  it("says a watch_broken alert with no failure count generically", () => {
    const message = alertMessage({ ...base, consecutiveFailures: null, rule: "watch_broken" });
    expect(message.body).toContain("Checks for this product keep failing.");
  });

  it("says a test alert is a test", () => {
    const message = alertMessage({ ...base, rule: "test" });
    expect(message.title).toBe("Test alert from DropWatch");
    expect(message.body).toContain("This is a test notification.");
  });

  it("omits price lines when the check found no price", () => {
    const message = alertMessage({
      ...base,
      inStock: null,
      pctChange: null,
      previousPrice: null,
      price: null,
    });
    expect(message.body).toBe(base.url);
  });
});
