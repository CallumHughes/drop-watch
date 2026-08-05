/**
 * The renderer sidecar's HTTP surface: a single `/render` endpoint plus
 * `/healthz`, fronting the Playwright driver in `./render`.
 *
 * Non-200 is reserved for the sidecar's own faults — 400 malformed request,
 * 429 at capacity, 500 renderer infrastructure failure, 503 shutting down.
 * Everything the target might do (timeout, HTTP error, network failure) still
 * comes back 200, because the render *ran*; the body's `status` says how it
 * went.
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
import { browserStatus, closeBrowser, renderPage, stalledRenderMs } from "./render";

const SERVICE_NAME = "drop-watch-renderer";

/** Playwright pages are heavy; keep concurrent renders modest by default. */
const DEFAULT_RENDER_CONCURRENCY = 2;
/** Once this many requests are queued behind `concurrency`, reject new ones outright rather than let them age out behind others' timeouts. */
const QUEUE_LIMIT_MULTIPLIER = 4;
/**
 * One absolute shutdown budget leaves margin under Docker's 30-second stop
 * grace. Only its first slice is available for draining; all browser launch,
 * graceful-close, and forced-kill work shares the same final deadline.
 */
const SHUTDOWN_BUDGET_MS = 28_000;
const RENDER_DRAIN_TIMEOUT_MS = 8000;

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
  if (shuttingDown) {
    return c.body(null, 503);
  }

  const requestLog = createLogger({ action: "render", url: parsed.data.url });
  let result: Awaited<ReturnType<typeof renderPage>>;
  try {
    result = await queue.add(() => renderPage(parsed.data));
  } catch (error) {
    requestLog.set({
      error: error instanceof Error ? error.message : String(error),
      renderStatus: "renderer_error",
    });
    requestLog.error("renderer infrastructure failure");
    requestLog.emit();
    return c.json({ error: "renderer infrastructure failure" }, 500);
  }
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

/**
 * Reports unhealthy for a stuck browser as well as a shutting-down one: a
 * Chromium that has stopped completing renders keeps `isConnected()` true while
 * holding its concurrency slots.
 */
app.get(HEALTH_PATH, (c) => {
  const stalledMs = stalledRenderMs();
  const ok = !(shuttingDown || stalledMs !== null);
  if (stalledMs !== null) {
    log.warn("renderer", `render stalled for ${stalledMs}ms; reporting unhealthy`);
  }
  return c.json(
    {
      browser: browserStatus(),
      inFlight: queue.pending,
      ok,
      queued: queue.size,
      ...(stalledMs === null ? {} : { stalledMs }),
    },
    ok ? 200 : 503
  );
});

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
    const deadlineAt = Date.now() + SHUTDOWN_BUDGET_MS;
    log.info("renderer", `${signal} received, stopping`);

    // Stop accepting new connections; existing responses still complete.
    server.close();
    // Queued renders have not started and must not launch Chromium after the
    // manager begins closing. Running renders may use the short drain slice.
    queue.pause();
    // Give in-flight renders a chance to finish, but do not wait forever.
    const drainMs = Math.min(RENDER_DRAIN_TIMEOUT_MS, Math.max(0, deadlineAt - Date.now()));
    await Promise.race([queue.onIdle(), sleep(drainMs)]);
    await closeBrowser(deadlineAt);

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
