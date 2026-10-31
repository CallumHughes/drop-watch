import { describe, expect, it } from "vitest";

import { challengeReason, challengeVendor } from "./challenge";

const GENERIC_SUBJECT = /^This site blocked this request\./;
const ANY_GENERIC_SUBJECT = /^This site /;

/**
 * Trimmed from the real 6,183-byte body boots.com served to a plain fetch —
 * enough of the head to carry the markers, which is all this matches on.
 */
const IMPERVA_INTERSTITIAL = `<!DOCTYPE html>
<html><head>
  <noscript><title>Pardon Our Interruption</title></noscript>
  <script>
    window.reeseSkipExpirationCheck = true;
    window.reeseSkipAutoLoad = true;
  </script>
  <script src="/_Incapsula_Resource?SWJIYLWA=719d34d31c8e3a6e6fffd425f7e032f3"></script>
</head><body><div class="container"><h1>Pardon Our Interruption</h1></div></body></html>`;

const PRODUCT_PAGE = `<!DOCTYPE html>
<html><head><title>Effaclar Duo 40ml</title>
  <script type="application/ld+json">
    {"@type":"Product","offers":{"@type":"Offer","price":"21.50","priceCurrency":"GBP"}}
  </script>
</head><body><span class="price">£21.50</span></body></html>`;

describe("challengeVendor", () => {
  it("names Imperva from its challenge script", () => {
    expect(challengeVendor(IMPERVA_INTERSTITIAL)).toBe("Imperva");
  });

  it.each([
    ["Akamai", '<div id="bm-verify">Verify you are human</div>'],
    [
      "Cloudflare",
      '<title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/h/b"></script>',
    ],
    ["Cloudflare", "<script>window._cf_chl_opt = {};</script>"],
    ["Cloudflare", '<script src="/cdn-cgi/challenge-platform/h/g/flow/ov1"></script>'],
    ["DataDome", '<iframe src="https://geo.captcha-delivery.com/captcha/"></iframe>'],
    ["PerimeterX", '<div id="px-captcha"></div>'],
  ])("names %s", (vendor, html) => {
    expect(challengeVendor(html)).toBe(vendor);
  });

  it("leaves a real product page alone", () => {
    expect(challengeVendor(PRODUCT_PAGE)).toBeNull();
  });

  it.each([
    '<script src="https://js.datadome.co/tags.js"></script>',
    '<script src="/cdn-cgi/challenge-platform/h/g/scripts/jsd/main.js"></script>',
    '<script src="/akam/13/5f7a1b2"></script><script src="akam-sw.js"></script>',
    '<script>window._abck="0~-1~-1";</script>',
    '<script src="/reese84"></script>',
    '<script src="/_Incapsula_Resource?SWJIYLWA=719d34d31c8e3a6e6fffd425f7e032f3"></script>',
    '<script src="https://client.perimeterx.net/px.js"></script><!-- PerimeterX -->',
    '<img data-size_px="640">',
    "<p>Just a moment while we check stock near you.</p>",
    "<p>Pardon Our Interruption is the name of this product.</p>",
  ])("does not mistake passive vendor code or ordinary text for a challenge: %s", (markup) => {
    const html = `<html><head><title>Product</title>${markup}</head><body><span class="custom-cost">£21.50</span></body></html>`;
    expect(challengeVendor(html)).toBeNull();
    expect(challengeReason(html, { httpStatus: 200 })).toBeNull();
  });

  // Markers live in the head; scanning a whole 5MB body on every check would be
  // paid for by the pages that are fine.
  it("does not scan past the head-sized window", () => {
    const buried = `${"<p>x</p>".repeat(4000)}_Incapsula_Resource`;
    expect(buried.length).toBeGreaterThan(20_000);
    expect(challengeVendor(buried)).toBeNull();
  });
});

describe("challengeReason", () => {
  it("names the vendor and the host, and says what will not help", () => {
    const reason = challengeReason(IMPERVA_INTERSTITIAL, {
      httpStatus: 200,
      transport: "http",
      url: "https://www.boots.com/product-10332063",
    });
    expect(reason).toBe(
      "boots.com blocked this request (Imperva bot protection). Browser mode may get through; a saved selector will not."
    );
  });

  // The vendors answer 403 with an empty body, so there is no markup left to
  // match and the status has to carry the verdict on its own.
  // Telling someone to try a browser is useless when the browser attempt is
  // the one that just failed.
  it("does not suggest a browser to an attempt that was already one", () => {
    expect(
      challengeReason(IMPERVA_INTERSTITIAL, {
        httpStatus: 200,
        transport: "browser",
        url: "https://www.boots.com/product-10332063",
      })
    ).toBe(
      "boots.com blocked this request (Imperva bot protection). A saved selector will not help: it would match the interstitial, not the product."
    );
  });

  it("gives the advice that holds either way when the transport is unknown", () => {
    expect(challengeReason(IMPERVA_INTERSTITIAL, { httpStatus: 200 })).toContain(
      "A saved selector will not help"
    );
  });

  it("treats a bodiless 403 as a block", () => {
    expect(
      challengeReason("", {
        httpStatus: 403,
        transport: "http",
        url: "https://www.superdrug.com/p/814543",
      })
    ).toBe(
      "superdrug.com blocked this request. Browser mode may get through; a saved selector will not."
    );
  });

  it("stays silent on a page that merely has no price", () => {
    expect(
      challengeReason(PRODUCT_PAGE, { httpStatus: 200, url: "https://store.test/p/1" })
    ).toBeNull();
  });

  it("does not read a 404 or a 500 as a block", () => {
    expect(challengeReason("<p>Not found</p>", { httpStatus: 404 })).toBeNull();
    expect(challengeReason("<p>Oops</p>", { httpStatus: 500 })).toBeNull();
  });

  it("falls back to a generic subject when the URL is absent or unparseable", () => {
    expect(challengeReason("", { httpStatus: 403 })).toMatch(GENERIC_SUBJECT);
    expect(challengeReason("", { httpStatus: 403, url: "not a url" })).toMatch(ANY_GENERIC_SUBJECT);
  });
});
