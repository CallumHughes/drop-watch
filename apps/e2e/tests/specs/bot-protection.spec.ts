import { expect, test } from "../fixtures";

/** The oRPC call the add-product form makes to fetch a preview. */
const PREVIEW_RPC = "**/api/rpc/preview/page";

/**
 * A queued check has to travel through pg-boss and the worker before the page's
 * polling shows it, which is about a second — see `check-now.spec.ts`. Kept far
 * above that so a slow runner cannot fail the suite over scheduling.
 */
const CHECK_TIMEOUT_MS = 45_000;

/** The named block first, the chain's own verdict kept behind it. */
const BLOCK_BEFORE_NO_PRICE = /blocked this request[\s\S]*no price found \(tried:/;
const BLOCK_BEFORE_STRATEGIES = /blocked this request[\s\S]*tried: jsonld/;

/**
 * The journey this suite exists for: a shop that refuses a headless browser.
 *
 * The fixture server answers these templates from the request rather than from
 * stored state, so no outside call is needed to reproduce the behaviour that
 * made browser mode useless — a 403 on the first request, before any page
 * JavaScript runs, to anything announcing a headless build.
 */
test("a shop that refuses headless browsers is still read in browser mode", async ({
  addProduct,
  fixtureProduct,
  productDetail,
}) => {
  await fixtureProduct.publish({ template: "bot-protection" });

  await test.step("the automatic preview escalates and comes back with the price", async () => {
    await addProduct.goto();
    await addProduct.loadPreview(fixtureProduct.url);
    await expect(addProduct.page.getByText("£100.00", { exact: true })).toBeVisible();
    await expect(addProduct.browserRenderProvenance).toBeVisible();
  });

  await test.step("nothing reports a failed browser attempt", async () => {
    await expect(addProduct.browserAlreadyFailedNote).not.toBeVisible();
    await expect(addProduct.noAutoMatchNote).not.toBeVisible();
  });

  await test.step("tracking saves browser mode", async () => {
    await addProduct.track();

    const listing = productDetail.listingRow(fixtureProduct.url);
    await listing.edit();
    await expect(listing.settings().browserRenderCheckbox).toBeChecked();
  });
});

test("a challenge interstitial is named, not reported as a page with no price", async ({
  addProduct,
  fixtureProduct,
}) => {
  await fixtureProduct.publish({ template: "bot-protection-interstitial" });

  await test.step("the preview explains the block", async () => {
    await addProduct.goto();
    await addProduct.loadPreview(fixtureProduct.url);
    await expect(addProduct.noAutoMatchNote).toBeVisible();
    await expect(
      addProduct.page.getByText(`${fixtureProduct.host} blocked this request`, { exact: false })
    ).toBeVisible();
    await expect(addProduct.page.getByText("Imperva bot protection")).toBeVisible();
  });

  // The chain's own verdict is true but useless on its own — acting on it means
  // writing a selector against markup that holds no product — so it is kept as
  // a diagnostic and the named block is what the reader meets first.
  await test.step("the block is named ahead of the chain's own verdict", async () => {
    await expect(addProduct.noAutoMatchNote).toContainText(BLOCK_BEFORE_NO_PRICE);
  });

  await test.step("the page cannot be tracked on a block", async () => {
    await expect(addProduct.trackButton).toBeDisabled();
  });
});

test("a browser attempt that already failed is reported, not offered again", async ({
  addProduct,
  fixtureProduct,
}) => {
  await fixtureProduct.publish({ template: "bot-protection-browser" });

  await test.step("the HTTP preview survives the failed escalation", async () => {
    await addProduct.goto();
    await addProduct.loadPreview(fixtureProduct.url);
    await expect(addProduct.noAutoMatchNote).toBeVisible();
    await expect(addProduct.browserRenderProvenance).not.toBeVisible();
  });

  await test.step("the panel names the refusal instead of charging another render", async () => {
    await expect(addProduct.browserAlreadyFailedNote).toBeVisible();
    await expect(addProduct.browserAlreadyFailedNote).toContainText("blocked this request");
    await expect(addProduct.reloadInBrowserButton).toBeDisabled();
  });
});

test("a total block is reported with its reason and a status a proxy forwards", async ({
  addProduct,
  fixtureProduct,
}) => {
  await fixtureProduct.publish({ template: "bot-protection-total" });

  await addProduct.goto();
  const previewResponse = addProduct.page.waitForResponse(PREVIEW_RPC);
  await addProduct.loadPreview(fixtureProduct.url);
  const response = await previewResponse;

  /**
   * 422, never a 5xx. A reverse proxy replaces the body of a 502/503/504 with
   * its own error page; oRPC's client then cannot parse it and falls back to
   * the generic text from its status table, which is how a named 403 reached
   * the screen as nothing but "Bad Gateway".
   */
  await test.step("the failure is a 4xx so its body survives a proxy", () => {
    expect(response.status()).toBe(422);
  });

  await test.step("the reason reaches the screen", async () => {
    await expect(addProduct.page.getByText("blocked this request")).toBeVisible();
    await expect(addProduct.page.getByText("Bad Gateway")).not.toBeVisible();
  });
});

/**
 * The worker's half of the same problem. A listing can be tracked happily and
 * only later find itself behind a challenge — a shop turning protection on, or
 * turning it on for us — and the check log is the only place that is visible.
 */
test("a scheduled check names the block in the check log", async ({
  addProduct,
  fixtureProduct,
  productDetail,
}) => {
  await test.step("track the product while it still answers normally", async () => {
    await addProduct.goto();
    await addProduct.loadPreview(fixtureProduct.url);
    await addProduct.track();
  });

  await test.step("the shop starts serving a challenge instead", async () => {
    await fixtureProduct.publish({ template: "bot-protection-interstitial" });
  });

  await test.step("the check's detail names the block", async () => {
    await productDetail.checkNow();
    await expect(productDetail.checkRunLog).toContainText("blocked this request", {
      timeout: CHECK_TIMEOUT_MS,
    });
    await expect(productDetail.checkRunLog).toContainText("Imperva bot protection", {
      timeout: CHECK_TIMEOUT_MS,
    });
  });

  /**
   * The run's status stays `extract_failed` — "no price found" is its label,
   * and it is accurate, since a 200 carrying no product is exactly that. What
   * had to change is the order of the detail beside it: the chain's own list of
   * strategies says nothing a reader can act on, so it follows the named block
   * rather than standing in for it. It is still recorded, because on a page
   * mistaken for a challenge it is the only thing left to diagnose from.
   */
  await test.step("the strategies it tried follow the block rather than replacing it", async () => {
    await expect(productDetail.checkRunLog).toContainText(BLOCK_BEFORE_STRATEGIES);
  });

  // This listing is in HTTP mode, so suggesting a browser is the useful advice;
  // a browser-mode listing is told the opposite.
  await test.step("the advice suits the transport that was refused", async () => {
    await expect(productDetail.checkRunLog).toContainText("Browser mode may get through");
  });
});
