import type { RouterClient } from "@orpc/server";

import { protectedProcedure, publicProcedure } from "../index";
import { previewRouter } from "./preview";
import { productsRouter } from "./products";

export const appRouter = {
  healthCheck: publicProcedure.handler(() => "OK"),
  /** The add-product flow's read-only half: fetch once, then test selectors. */
  preview: previewRouter,
  privateData: protectedProcedure.handler(({ context }) => ({
    message: "This is private",
    user: context.session?.user,
  })),
  products: productsRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
