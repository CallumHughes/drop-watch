/**
 * Runtime feature flags for the web app, as opposed to the build-time
 * `NEXT_PUBLIC_EMAIL_ENABLED` pattern. That flag exists to keep a mail
 * credential secret — asking the API "do you have a mail key?" would answer
 * that for anyone. Whether a self-hosted box runs a renderer is not a secret,
 * and `protectedProcedure` means only signed-in users are told. More
 * decisively, browser mode is switched on at runtime via
 * `COMPOSE_PROFILES=browser` + `RENDER_URL`, not baked into the image at
 * build time — a build flag would leave a dead toggle until someone
 * rebuilt, the exact trap docker-compose.yml already warns about for email.
 *
 * Not `adminProcedure`: every signed-in user can add products. Not
 * `publicProcedure`: nothing here is needed before sign-in.
 */

import { env } from "@drop-watch/env/server";

import { protectedProcedure } from "../index";

/** A shape rather than a bare boolean so growing it later is additive. */
export interface Capabilities {
  /** Whether a renderer sidecar is configured (`RENDER_URL`). */
  browserRender: boolean;
}

export const capabilities = protectedProcedure.handler(
  (): Capabilities => ({ browserRender: env.RENDER_URL !== undefined })
);
