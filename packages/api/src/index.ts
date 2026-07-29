import { ORPCError, os } from "@orpc/server";

import type { Context } from "./context";

export const o = os.$context<Context>();

export const publicProcedure = o;

const requireAuth = o.middleware(({ context, next }) => {
  if (!context.session?.user) {
    throw new ORPCError("UNAUTHORIZED");
  }
  return next({
    context: {
      session: context.session,
    },
  });
});

export const protectedProcedure = publicProcedure.use(requireAuth);

/**
 * Signed in *and* an admin. FORBIDDEN rather than UNAUTHORIZED for a
 * non-admin: the session is fine, the role is not, and pretending otherwise
 * would send the client into a pointless re-login loop.
 */
const requireAdmin = o.middleware(({ context, next }) => {
  if (!context.session?.user) {
    throw new ORPCError("UNAUTHORIZED");
  }
  if (context.session.user.role !== "admin") {
    throw new ORPCError("FORBIDDEN");
  }
  return next({
    context: {
      session: context.session,
    },
  });
});

export const adminProcedure = publicProcedure.use(requireAdmin);
