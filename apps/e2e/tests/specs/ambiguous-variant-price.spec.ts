import { expect, test } from "../fixtures";

const CHECK_TIMEOUT_MS = 45_000;
const SELECTED_VARIANT_SELECTOR = '[data-testid="price-now"]';

/**
 * Reproduces the retailer failure that motivated the extraction guardrail: the
 * visible large size costs £499, while document-order JSON-LD can point at a
 * much cheaper, unselected size. The scenario covers both new trackers and a
 * legacy automatic listing repaired in place.
 *
 * The repair is driven the way the dashboard now offers it — by saying what
 * price the page shows — with one pass through the "Advanced" disclosure so the
 * hand-written escape hatch stays covered.
 */
test("an ambiguous size price is rejected until the displayed price is named", async ({
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

  await test.step("naming the displayed price resolves the ambiguity", async () => {
    await addProduct.locatePrice("499.00");
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

    // Reverting to the automatic chain is itself a repair now: re-preview a
    // page it reads unambiguously, and the panel offers to clear the pin.
    await fixtureProduct.publish({ price: "499.00", template: "jsonld" });
    const reverting = productDetail.listingRow(fixtureProduct.url);
    await reverting.edit();
    const revertSettings = reverting.settings();
    await revertSettings.repairButton.click();
    await expect(revertSettings.applyRepairButton).toBeEnabled();
    await revertSettings.applyRepairButton.click();
    await expect(revertSettings.extractionNote).toContainText("Found automatically");
    await revertSettings.saveButton.click();
    await expect(productDetail.page.getByText("Listing settings saved.")).toBeVisible();

    await fixtureProduct.publish({
      cheapPrice: "79.00",
      cheapVariantFirst: true,
      price: "499.00",
      template: "ambiguous-sizes",
    });
    const listing = productDetail.listingRow(fixtureProduct.url);
    await listing.checkNow();

    await expect(listing.status).toContainText("failed · no price found", {
      timeout: CHECK_TIMEOUT_MS,
    });
    await expect(productDetail.currentPrice).toHaveText("£499.00");
    await expect(productDetail.stat("Min")).toHaveText("£499.00");
    expect(await webhookSink.alertsFor(fixtureProduct.url)).toEqual([]);
  });

  await test.step("repairing in place by naming the price tracks it again", async () => {
    await fixtureProduct.setPrice("479.00");

    const listing = productDetail.listingRow(fixtureProduct.url);
    await listing.edit();
    const settings = listing.settings();
    await settings.repairButton.click();
    await settings.locatePrice("479.00");
    await expect(settings.applyRepairButton).toBeEnabled();

    // Correcting the figure has to withdraw what the previous one found. The
    // pin used to survive, so Apply went on offering an expression for a price
    // the panel was simultaneously reporting as not on the page.
    await settings.expectedPriceInput.fill("12.34");
    await expect(settings.notFoundNote).toBeVisible();
    await expect(settings.applyRepairButton).toBeDisabled();

    await settings.locatePrice("479.00");
    await expect(settings.applyRepairButton).toBeEnabled();
    await settings.applyRepairButton.click();
    await expect(settings.extractionNote).toContainText("Read from a spot");
    await settings.saveButton.click();

    await listing.checkNow();
    await expect(productDetail.currentPrice).toHaveText("£479.00", {
      timeout: CHECK_TIMEOUT_MS,
    });
    expect(await webhookSink.alertsFor(fixtureProduct.url)).toEqual([]);
  });

  await test.step("the advanced disclosure still pins an expression by hand", async () => {
    const listing = productDetail.listingRow(fixtureProduct.url);
    await listing.edit();
    const settings = listing.settings();
    await settings.repairButton.click();
    await settings.openAdvanced();
    await settings.expressionInput("CSS selector").fill(SELECTED_VARIANT_SELECTOR);
    await expect(settings.singleMatchNote).toBeVisible();
    await expect(settings.applyRepairButton).toBeEnabled();
    await settings.applyRepairButton.click();
    await settings.saveButton.click();

    await listing.checkNow();
    await expect(productDetail.currentPrice).toHaveText("£479.00", {
      timeout: CHECK_TIMEOUT_MS,
    });
  });
});
