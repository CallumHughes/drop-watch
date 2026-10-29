import { expect, test } from "../fixtures";

const CHECK_TIMEOUT_MS = 45_000;
const SELECTED_VARIANT_SELECTOR = '[data-testid="price-now"]';

/**
 * Reproduces the retailer failure that motivated the extraction guardrail: the
 * visible large size costs £499, while document-order JSON-LD can point at a
 * much cheaper, unselected size. The scenario covers both new trackers and a
 * legacy automatic listing repaired in place.
 */
test("an ambiguous size price is rejected until a one-match selector is pinned", async ({
  addProduct,
  fixtureProduct,
  productDetail,
  webhookSink,
}) => {
  await fixtureProduct.publish({
    cheapPrice: "99.00",
    cheapVariantFirst: false,
    price: "499.00",
    template: "ambiguous-sizes",
  });

  await test.step("a new low-confidence automatic result cannot be saved as-is", async () => {
    await addProduct.goto();
    await addProduct.loadPreview(fixtureProduct.url);

    await expect(addProduct.automaticRepairWarning).toBeVisible();
    await expect(addProduct.trackButton).toBeDisabled();
  });

  await test.step("a selector matching the displayed variant exactly can be saved", async () => {
    await addProduct.selectorInput.fill(SELECTED_VARIANT_SELECTOR);
    await expect(addProduct.page.getByText("1 match", { exact: true })).toBeVisible();
    await expect(addProduct.trackButton).toBeEnabled();
    await addProduct.track();

    await productDetail.checkNow();
    await expect(productDetail.currentPrice).toHaveText("£499.00", {
      timeout: CHECK_TIMEOUT_MS,
    });
  });

  await test.step("a legacy automatic check rejects a cheap offer after JSON-LD reorders", async () => {
    await productDetail.dropRuleCheckbox.check();
    await productDetail.dropPercentInput.fill("50");
    await productDetail.saveSettingsButton.click();
    await expect(productDetail.settingsSavedToast).toBeVisible();

    await fixtureProduct.publish({ cheapPrice: "79.00", cheapVariantFirst: true });

    const listing = productDetail.listingRow(fixtureProduct.url);
    await listing.edit();
    const settings = listing.settings();
    await settings.extractorSelect.selectOption("auto");
    await settings.saveButton.click();
    await expect(productDetail.page.getByText("Listing settings saved.")).toBeVisible();
    await listing.checkNow();

    await expect(listing.status).toContainText("failed · no price found", {
      timeout: CHECK_TIMEOUT_MS,
    });
    await expect(productDetail.currentPrice).toHaveText("£499.00");
    await expect(productDetail.stat("Min")).toHaveText("£499.00");
    expect(await webhookSink.alertsFor(fixtureProduct.url)).toEqual([]);
  });

  await test.step("repairing the listing in place tracks the displayed price again", async () => {
    await fixtureProduct.setPrice("479.00");

    const listing = productDetail.listingRow(fixtureProduct.url);
    await listing.edit();
    const settings = listing.settings();
    await settings.repairButton.click();
    await settings.expressionInput("CSS selector").fill(SELECTED_VARIANT_SELECTOR);
    await expect(settings.singleMatchNote).toBeVisible();
    await expect(settings.applyRepairButton).toBeEnabled();
    await settings.applyRepairButton.click();
    await expect(settings.extractorSelect).toHaveValue("selector");
    await expect(settings.expressionInput("CSS selector")).toHaveValue(SELECTED_VARIANT_SELECTOR);
    await settings.saveButton.click();

    await listing.checkNow();
    await expect(productDetail.currentPrice).toHaveText("£479.00", {
      timeout: CHECK_TIMEOUT_MS,
    });
    expect(await webhookSink.alertsFor(fixtureProduct.url)).toEqual([]);
  });
});
