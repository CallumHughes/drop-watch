/**
 * Stock from an embedded Shopify product object (`{{ product | json }}`), for
 * Shopify pages whose structured data carries a price but no availability.
 *
 * Only an object whose `handle` matches the URL's `/products/<handle>` counts,
 * so a related product or a cart blob cannot answer for the tracked one.
 */

import { isRecord, type JsonRecord, MAX_NODES, MAX_WALK_DEPTH } from "./json";
import type { JsonDocument } from "./json-documents";
import type { Availability } from "./types";

const PRODUCT_PATH = /\/products\/(?<handle>[^/?#]+)/u;

export function shopifyHandle(url: string | undefined): string | null {
  if (!url) {
    return null;
  }
  try {
    const encoded = PRODUCT_PATH.exec(new URL(url).pathname)?.groups?.handle;
    return encoded ? decodeURIComponent(encoded).toLowerCase() : null;
  } catch {
    return null;
  }
}

function findProducts(value: unknown, handle: string, out: JsonRecord[], depth: number): void {
  if (depth > MAX_WALK_DEPTH || out.length >= MAX_NODES) {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      findProducts(entry, handle, out, depth + 1);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  if (
    typeof value.handle === "string" &&
    value.handle.toLowerCase() === handle &&
    Array.isArray(value.variants)
  ) {
    out.push(value);
    return;
  }
  for (const entry of Object.values(value)) {
    findProducts(entry, handle, out, depth + 1);
  }
}

/** A variant named by `?variant=` must be found; otherwise the product-level flag. */
function productAvailable(product: JsonRecord, variantId: string | null): boolean | null {
  const variants = (product.variants as unknown[]).filter(isRecord);
  if (variantId) {
    const variant = variants.find((entry) => String(entry.id) === variantId);
    return typeof variant?.available === "boolean" ? variant.available : null;
  }
  if (typeof product.available === "boolean") {
    return product.available;
  }
  const flags = variants.map((entry) => entry.available);
  if (flags.length === 0 || !flags.every((flag) => typeof flag === "boolean")) {
    return null;
  }
  return flags.includes(true);
}

export function shopifyAvailability(
  documents: readonly JsonDocument[],
  url: string | undefined
): Availability | null {
  const handle = shopifyHandle(url);
  if (!(handle && url)) {
    return null;
  }
  const variantId = new URL(url).searchParams.get("variant");

  const products: JsonRecord[] = [];
  for (const document of documents) {
    findProducts(document.value, handle, products, 0);
  }

  const answers = new Set(
    products.map((product) => productAvailable(product, variantId)).filter((v) => v !== null)
  );
  // Disagreeing copies are as good as none.
  if (answers.size !== 1) {
    return null;
  }
  const inStock = answers.has(true);
  return { availability: inStock ? "InStock" : "OutOfStock", inStock };
}
