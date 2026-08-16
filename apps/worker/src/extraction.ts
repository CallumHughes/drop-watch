/**
 * Which strategies a listing runs, and the expression they read.
 *
 * Its own module for the same reason `./outcome` and `./retrieve` are:
 * `./check-listing` imports `@drop-watch/db` at module scope, which validates
 * environment variables on import and makes anything living there untestable
 * without a database URL. Nothing here touches the database or the network.
 */

import type { ExtractOptions } from "@drop-watch/core/extract";
import { STRATEGY_ORDER } from "@drop-watch/core/extract";
import { toExpressionMode } from "@drop-watch/core/extract/strategies";
import type { Listing } from "@drop-watch/db/schema/products";

/**
 * One function rather than two so the pinned mode and the expression cannot
 * disagree — feeding a JSONPath to the CSS engine because the mode said one
 * thing and the column held another is exactly the bug a single column invites.
 *
 * `extractor` is a text column rather than a pg enum (strategy names are owned
 * by `@drop-watch/core`, so adding one is not a migration). The membership
 * check is what that costs: an unrecognised value falls back to the chain
 * instead of throwing on a `STRATEGIES` lookup miss.
 */
export function extractionOptions(
  listing: Listing
): Pick<ExtractOptions, "expression" | "strategies"> {
  const pinned = toExpressionMode(listing.extractor);
  if (!(pinned && listing.expression)) {
    return { strategies: STRATEGY_ORDER };
  }
  // A pinned listing should fail loudly when its expression rots, not quietly
  // start reporting whatever JSON-LD the page happens to carry.
  return { expression: listing.expression, strategies: [pinned] };
}
