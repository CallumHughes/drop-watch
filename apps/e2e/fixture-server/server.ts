/**
 * The stand-in for everything outside the app: the retailer pages the app
 * scrapes and the Home Assistant instance it alerts.
 *
 * The app's outbound HTTP happens server-side (undici in the web and worker
 * processes), where Playwright's request interception cannot reach — so tests
 * point the app at this server instead. Plain node:http, no dependencies;
 * started by Playwright's `webServer` and health-checked on /__health.
 *
 * Routes:
 * - PUT  /__products/:slug   register or update a product page's state
 * - GET  /products/:slug     the product page itself (what the app scrapes)
 * - POST /api/webhook/:id    Home Assistant webhook sink — records the payload
 * - GET  /__webhooks/:id     recorded payloads for that webhook id, as JSON
 * - POST /emails             fake Resend API — records the mail, returns an id
 * - GET  /__emails           every recorded mail, oldest first, as JSON
 * - GET  /__health           liveness for Playwright's webServer readiness
 *
 * `/emails` is the path the Resend SDK POSTs to, so pointing `RESEND_BASE_URL`
 * here makes this server the app's mailer with no code changes: the SDK's
 * request body (from, to, subject, html, text) is recorded verbatim and a
 * success response is returned, exactly as the webhook sink plays Home
 * Assistant.
 *
 * State is in-memory and per-run. Parallel tests stay isolated by using unique
 * slugs, never by clearing shared state.
 *
 * One socket, many names: the listen is unbound, so every host in
 * `FIXTURE_HOSTS` reaches this same process and the same state. Which name a
 * test scrapes is what gives its worker a fetch queue of its own — see the
 * comment on `FIXTURE_HOSTS`.
 */

import { lookup } from "node:dns/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { FIXTURE_HOSTS, FIXTURE_PORT } from "../constants";
import { type FixtureProductState, renderProductPage } from "./templates";

const products = new Map<string, FixtureProductState>();
const webhooks = new Map<string, unknown[]>();
const emails: unknown[] = [];

const OK = 200;
const NO_CONTENT = 204;
const BAD_REQUEST = 400;
const NOT_FOUND = 404;

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function sendText(response: ServerResponse, status: number, body: string, type: string): void {
  response.writeHead(status, { "content-type": type });
  response.end(body);
}

async function putProduct(
  request: IncomingMessage,
  response: ServerResponse,
  slug: string
): Promise<void> {
  const body = await readBody(request);
  try {
    products.set(slug, JSON.parse(body) as FixtureProductState);
  } catch {
    sendJson(response, BAD_REQUEST, { error: "body must be JSON product state" });
    return;
  }
  response.writeHead(NO_CONTENT);
  response.end();
}

function getProduct(request: IncomingMessage, response: ServerResponse, slug: string): void {
  const state = products.get(slug);
  if (!state) {
    sendText(response, NOT_FOUND, "no such fixture product", "text/plain");
    return;
  }
  const url = `http://${request.headers.host ?? `localhost:${FIXTURE_PORT}`}/products/${slug}`;
  sendText(response, OK, renderProductPage(state, url), "text/html; charset=utf-8");
}

async function recordWebhook(
  request: IncomingMessage,
  response: ServerResponse,
  id: string
): Promise<void> {
  const body = await readBody(request);
  let payload: unknown = body;
  try {
    payload = JSON.parse(body);
  } catch {
    // Kept as the raw string — the assertion failing on shape is information.
  }
  const received = webhooks.get(id) ?? [];
  received.push(payload);
  webhooks.set(id, received);
  sendJson(response, OK, { ok: true });
}

async function recordEmail(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readBody(request);
  try {
    emails.push(JSON.parse(body));
  } catch {
    sendJson(response, BAD_REQUEST, { error: "body must be JSON" });
    return;
  }
  // The shape the Resend SDK treats as a successful send.
  sendJson(response, OK, { id: `e2e-mail-${emails.length}` });
}

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", `http://localhost:${FIXTURE_PORT}`);
  const [, root, tail] = url.pathname.split("/");

  if (url.pathname === "/__health") {
    sendText(response, OK, "ok", "text/plain");
    return;
  }
  if (request.method === "PUT" && root === "__products" && tail) {
    await putProduct(request, response, tail);
    return;
  }
  if (request.method === "GET" && root === "products" && tail) {
    getProduct(request, response, tail);
    return;
  }
  if (request.method === "POST" && url.pathname.startsWith("/api/webhook/")) {
    await recordWebhook(request, response, url.pathname.slice("/api/webhook/".length));
    return;
  }
  if (request.method === "GET" && root === "__webhooks" && tail) {
    sendJson(response, OK, webhooks.get(tail) ?? []);
    return;
  }
  if (request.method === "POST" && url.pathname === "/emails") {
    await recordEmail(request, response);
    return;
  }
  if (request.method === "GET" && url.pathname === "/__emails") {
    sendJson(response, OK, emails);
    return;
  }
  sendText(response, NOT_FOUND, "not found", "text/plain");
}

/** Why `host` cannot be used, or null if it resolves to loopback. */
async function hostProblem(host: string): Promise<string | null> {
  try {
    const addresses = await lookup(host, { all: true });
    const foreign = addresses.find((entry) => !isLoopback(entry.address));
    return foreign ? `${host} resolves to ${foreign.address}, which is not loopback` : null;
  } catch (error) {
    return `${host} does not resolve (${error instanceof Error ? error.message : String(error)})`;
  }
}

function isLoopback(address: string): boolean {
  return address === "::1" || address.startsWith("127.");
}

/**
 * Every worker host has to resolve to this machine before the socket opens.
 *
 * `*.localhost` is loopback by RFC 6761 and resolves unaided on macOS and on
 * the CI runner, but a machine with a stripped-down resolver would answer
 * nothing — and the symptom would otherwise be scrape failures in whichever
 * spec happened to land there. Checking before `listen` turns that into one
 * named failure of Playwright's `webServer` readiness instead. Reachability
 * needs no check of its own: the listen below is unbound, so anything that
 * resolves to loopback arrives here.
 */
async function verifyHosts(): Promise<void> {
  const problems = (await Promise.all(FIXTURE_HOSTS.map(hostProblem))).filter(
    (problem) => problem !== null
  );
  if (problems.length > 0) {
    process.stderr.write(`fixture server host check failed:\n  ${problems.join("\n  ")}\n`);
    process.exit(1);
  }
}

const server = createServer((request, response) => {
  route(request, response).catch((error: unknown) => {
    sendJson(response, BAD_REQUEST, { error: String(error) });
  });
});

await verifyHosts();

server.listen(FIXTURE_PORT, () => {
  process.stdout.write(
    `fixture server listening on :${FIXTURE_PORT} as ${FIXTURE_HOSTS.join(", ")}\n`
  );
});
