import { signupOpen } from "@drop-watch/db/signup";
import type { RouterClient } from "@orpc/server";

import { protectedProcedure, publicProcedure } from "../index";
import { invitesRouter } from "./invites";
import { previewRouter } from "./preview";
import { productsRouter } from "./products";
import { settingsRouter } from "./settings";

export const appRouter = {
  healthCheck: publicProcedure.handler(() => "OK"),
  /** Admin-issued invites: the only way in after the bootstrap account. */
  invites: invitesRouter,
  /** The add-product flow's read-only half: fetch once, then test selectors. */
  preview: previewRouter,
  privateData: protectedProcedure.handler(({ context }) => ({
    message: "This is private",
    user: context.session?.user,
  })),
  products: productsRouter,
  /** Home Assistant webhook config, alert thresholds, and the test button. */
  settings: settingsRouter,
  /**
   * Whether the login page should still offer to create an account. Public by
   * necessity — it is what an unauthenticated visitor asks — and it leaks
   * nothing beyond "this instance has been set up", which the login form
   * already tells you.
   */
  signupOpen: publicProcedure.handler((): Promise<boolean> => signupOpen()),
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
