import { auth } from "@drop-watch/auth";
import { type BetterAuthInstance, createAuthMiddleware } from "evlog/better-auth";

import { useLogger } from "@/lib/evlog";

const identifyUser = createAuthMiddleware(auth as BetterAuthInstance, {
  exclude: ["/api/auth/**"],
  maskEmail: true,
});

export async function identifyEvlogUser(request: Request) {
  // biome-ignore lint/correctness/useHookAtTopLevel: useLogger is an evlog accessor, not a React hook.
  await identifyUser(useLogger(), request.headers, new URL(request.url).pathname);
}
