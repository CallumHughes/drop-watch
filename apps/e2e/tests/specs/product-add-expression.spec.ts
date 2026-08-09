import { expect, test } from "../fixtures";

/**
 * The two pages a CSS selector cannot handle: one whose price is only ever an
 * attribute value, and one whose price only exists inside an embedded JSON
 * payload. Both must fall through the automatic chain and then be rescued by
 * the picker.
 */

test("tracks an attribute-only price with a regular expression", async ({
  addProduct,
  dashboard,
  fixtureProduct,
}) => {
  await fixtureProduct.publish({ price: "42.50", template: "regex-only" });

  await test.step("the automatic chain finds nothing and offers the picker", async () => {
    await addProduct.goto();
    await addProduct.loadPreview(fixtureProduct.url);
    await expect(addProduct.noAutoMatchNote).toBeVisible();
  });

  await test.step("a CSS selector cannot reach a value that is never text", async () => {
    await addProduct.selectorInput.fill(".price");
    await expect(addProduct.page.getByText("no price could be read")).toBeVisible();
  });

  await test.step("a regular expression reads it out of the attribute", async () => {
    await addProduct.mode("Regular expression").click();
    await addProduct.regexInput.fill('data-price="([\\d.]+)"');
    await expect(addProduct.strategyNote).toContainText("regular expression");
  });

  await test.step("saving works from the regex path", async () => {
    await addProduct.track();
    await dashboard.goto();
    await expect(dashboard.productLink(fixtureProduct.title)).toBeVisible();
  });
});

test("tracks a price that only exists in embedded JSON with a JSONPath", async ({
  addProduct,
  dashboard,
  fixtureProduct,
}) => {
  await fixtureProduct.publish({ price: "18.99", template: "json-blob" });

  await test.step("the automatic chain finds nothing and offers the picker", async () => {
    await addProduct.goto();
    await addProduct.loadPreview(fixtureProduct.url);
    await expect(addProduct.noAutoMatchNote).toBeVisible();
  });

  await test.step("a JSONPath resolves it out of the payload", async () => {
    await addProduct.mode("JSONPath").click();
    await addProduct.jsonPathInput.fill("$..price");
    await expect(addProduct.strategyNote).toContainText("JSONPath");
  });

  await test.step("saving works from the JSONPath path", async () => {
    await addProduct.track();
    await dashboard.goto();
    await expect(dashboard.productLink(fixtureProduct.title)).toBeVisible();
  });
});

test("refuses a regular expression that could hang the worker", async ({
  addProduct,
  fixtureProduct,
}) => {
  await fixtureProduct.publish({ price: "42.50", template: "regex-only" });

  await addProduct.goto();
  await addProduct.loadPreview(fixtureProduct.url);
  await addProduct.mode("Regular expression").click();
  await addProduct.regexInput.fill("(a+)+$");

  // The picker and the save path run the same guard, so this can never be
  // typed here and then accepted on submit.
  await expect(addProduct.page.getByText("more than one way")).toBeVisible();
});
