/**
 * The renderer sidecar's HTTP surface: a single `/render` endpoint plus
 * `/healthz`, fronting the Playwright driver in `./render`.
 *
 * Non-200 is reserved for the sidecar's own faults — 400 malformed request,
 * 429 at capacity, 503 shutting down. Everything else the render itself might
 * do (timeout, HTTP error from the target, network failure) still comes back
 * 200, because the render *ran*; the body's `status` field says how it went.
 * That split keeps "the retailer is broken" and "my renderer is broken" from
 * collapsing into the same signal for the worker.
 */

import {
  DEFAULT_RENDER_PORT,
  HEALTH_PATH,
  RENDER_PATH,
  renderRequestSchema,
} from "@drop-watch/core/render/contract";
import type { ServerType } from "@hono/node-server";
import { serve } from "@hono/node-server";
import { createLogger, initLogger, log } from "evlog";
import { Hono } from "hono";
import PQueue from "p-queue";
import { browserStatus, closeBrowser, renderPage } from "./render";

const SERVICE_NAME = "drop-watch-renderer";

/** Playwright pages are heavy; keep concurrent renders modest by default. */
const DEFAULT_RENDER_CONCURRENCY = 2;
/** Once this many requests are queued behind `concurrency`, reject new ones outright rather than let them age out behind others' timeouts. */
const QUEUE_LIMIT_MULTIPLIER = 4;
/**
 * How long shutdown waits for in-flight renders to drain before closing the
 * browser and exiting anyway. Must stay comfortably under the worker's
 * `SHUTDOWN_TIMEOUT_MS` (30_000, `apps/worker/src/index.ts`) — otherwise a
 * stack-wide `docker compose down` kills this service mid-render while the
 * worker is still politely waiting for an answer that will never come.
 */
const RENDER_SHUTDOWN_TIMEOUT_MS = 20_000;

const port = Number(process.env.RENDER_PORT) || DEFAULT_RENDER_PORT;
const concurrency = Number(process.env.RENDER_CONCURRENCY) || DEFAULT_RENDER_CONCURRENCY;
const queueLimit = concurrency * QUEUE_LIMIT_MULTIPLIER;

const queue = new PQueue({ concurrency });
let shuttingDown = false;

const app = new Hono();

app.post(RENDER_PATH, async (c) => {
  if (shuttingDown) {
    return c.body(null, 503);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = renderRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  if (queue.size >= queueLimit) {
    return c.json({ error: "renderer at capacity" }, 429);
  }

  const requestLog = createLogger({ action: "render", url: parsed.data.url });
  const result = await queue.add(() => renderPage(parsed.data));
  // `renderStatus`, not `status`: evlog reserves `status` for a numeric HTTP
  // status, and this is the render's own outcome variant.
  requestLog.set({ durationMs: result.durationMs, renderStatus: result.status });
  if (result.status === "ok") {
    requestLog.info("render complete");
  } else {
    requestLog.warn(result.error);
  }
  requestLog.emit();

  return c.json(result, 200);
});

app.get(HEALTH_PATH, (c) =>
  c.json(
    {
      browser: browserStatus(),
      inFlight: queue.pending,
      ok: !shuttingDown,
      queued: queue.size,
    },
    shuttingDown ? 503 : 200
  )
);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function installShutdown(server: ServerType): void {
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) {
      return;
    }
    stopping = true;
    shuttingDown = true;
    log.info("renderer", `${signal} received, stopping`);

    // Stop accepting new connections; existing responses still complete.
    server.close();
    // Give in-flight renders a chance to finish, but do not wait forever.
    await Promise.race([queue.onIdle(), sleep(RENDER_SHUTDOWN_TIMEOUT_MS)]);
    await closeBrowser();

    process.exit(0);
  };

  const onSignal = (signal: NodeJS.Signals) => {
    shutdown(signal).catch(() => process.exit(1));
  };

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}

function main(): void {
  initLogger({
    env: { environment: process.env.NODE_ENV ?? "development", service: SERVICE_NAME },
  });

  const server = serve({ fetch: app.fetch, port }, (info) => {
    log.info({ action: "renderer_started", concurrency, port: info.port });
  });
  installShutdown(server);
}

main();
