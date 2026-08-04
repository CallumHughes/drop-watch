import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RenderResponse } from "./contract";
import { renderRequestSchema } from "./contract";
import { renderPage, toFetchResult } from "./index";

describe("toFetchResult", () => {
  it("renames html to body and keeps url on the ok variant", () => {
    const response: RenderResponse = {
      durationMs: 42,
      html: "<html>hi</html>",
      httpStatus: 200,
      status: "ok",
      url: "https://example.com/final",
    };
    expect(toFetchResult(response)).toEqual({
      body: "<html>hi</html>",
      durationMs: 42,
      httpStatus: 200,
      status: "ok",
      url: "https://example.com/final",
    });
  });

  it("maps http_error straight through", () => {
    const response: RenderResponse = {
      durationMs: 10,
      error: "renderer responded 503",
      httpStatus: 503,
      status: "http_error",
    };
    expect(toFetchResult(response)).toEqual({
      durationMs: 10,
      error: "renderer responded 503",
      httpStatus: 503,
      status: "http_error",
    });
  });

  it("maps network_error straight through", () => {
    const response: RenderResponse = {
      durationMs: 5,
      error: "connection refused",
      status: "network_error",
    };
    expect(toFetchResult(response)).toEqual({
      durationMs: 5,
      error: "connection refused",
      status: "network_error",
    });
  });

  it("maps timeout straight through", () => {
    const response: RenderResponse = {
      durationMs: 20_000,
      error: "timed out after 20000ms",
      status: "timeout",
    };
    expect(toFetchResult(response)).toEqual({
      durationMs: 20_000,
      error: "timed out after 20000ms",
      status: "timeout",
    });
  });

  it("never emits etag or lastModified", () => {
    const response: RenderResponse = {
      durationMs: 1,
      html: "<html></html>",
      httpStatus: 200,
      status: "ok",
      url: "https://example.com",
    };
    const result = toFetchResult(response);
    expect(result).not.toHaveProperty("etag");
    expect(result).not.toHaveProperty("lastModified");
  });
});

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Uint8Array[] = [];
    req.on("data", (chunk: Uint8Array) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

/**
 * The sidecar's real endpoint is fixed by `RENDER_PATH`, so these tests pick
 * a scenario by encoding a keyword into the `url` field of the request body
 * (the product URL being "rendered") rather than by dispatching on request
 * path.
 */
describe("renderPage", () => {
  let server: Server;
  let origin: string;
  let unreachableOrigin: string;
  const receivedBodies: string[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      readRequestBody(req).then((raw) => {
        receivedBodies.push(raw);
        let body: unknown = null;
        try {
          body = JSON.parse(raw);
        } catch {
          // handled below via the default branch
        }
        const targetUrl =
          typeof body === "object" && body !== null && "url" in body
            ? String((body as { url: unknown }).url)
            : "";

        if (targetUrl.includes("mode-500")) {
          res.writeHead(500);
          res.end("sidecar exploded");
          return;
        }
        if (targetUrl.includes("mode-429")) {
          res.writeHead(429);
          res.end("at capacity");
          return;
        }
        if (targetUrl.includes("mode-malformed-json")) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end("{not valid json");
          return;
        }
        if (targetUrl.includes("mode-invalid-schema")) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ status: "ok" }));
          return;
        }
        if (targetUrl.includes("mode-hang")) {
          // Never respond; the client's own deadline is what ends this.
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            durationMs: 7,
            html: "<html>rendered</html>",
            httpStatus: 200,
            status: "ok",
            url: targetUrl,
          })
        );
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const { port } = server.address() as AddressInfo;
    origin = `http://127.0.0.1:${port}`;

    // A port nothing listens on, for the "unreachable sidecar" case: bind,
    // read the port, then close it immediately.
    const closed = createServer();
    await new Promise<void>((resolve) => {
      closed.listen(0, "127.0.0.1", resolve);
    });
    const { port: closedPort } = closed.address() as AddressInfo;
    await new Promise<void>((resolve, reject) => {
      closed.close((error) => (error ? reject(error) : resolve()));
    });
    unreachableOrigin = `http://127.0.0.1:${closedPort}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("renders a page on the happy path", async () => {
    const result = await renderPage(origin, "https://example.com/product");
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.body).toBe("<html>rendered</html>");
      expect(result.httpStatus).toBe(200);
      expect(result.url).toBe("https://example.com/product");
    }
  });

  it("sends a request body that satisfies renderRequestSchema", async () => {
    receivedBodies.length = 0;
    await renderPage(origin, "https://example.com/product", {
      locale: "en-GB",
      timeoutMs: 5000,
      waitUntil: "domcontentloaded",
    });
    const sent = JSON.parse(receivedBodies.at(-1) ?? "null");
    expect(renderRequestSchema.safeParse(sent).success).toBe(true);
  });

  it("returns network_error mentioning the renderer on a sidecar 500", async () => {
    const result = await renderPage(origin, "https://example.com/mode-500");
    expect(result.status).toBe("network_error");
    if (result.status === "network_error") {
      expect(result.error).toContain("renderer");
      expect(result.error).toContain("500");
    }
  });

  it("returns network_error on a sidecar 429", async () => {
    const result = await renderPage(origin, "https://example.com/mode-429");
    expect(result.status).toBe("network_error");
    if (result.status === "network_error") {
      expect(result.error).toContain("renderer");
      expect(result.error).toContain("429");
    }
  });

  it("returns network_error for a malformed JSON body on a 200, not a throw", async () => {
    const result = await renderPage(origin, "https://example.com/mode-malformed-json");
    expect(result.status).toBe("network_error");
  });

  it("returns network_error when a 200 body fails renderResponseSchema", async () => {
    const result = await renderPage(origin, "https://example.com/mode-invalid-schema");
    expect(result.status).toBe("network_error");
  });

  it("returns timeout when the sidecar never responds", async () => {
    const result = await renderPage(origin, "https://example.com/mode-hang", {
      timeoutMs: 50,
    });
    expect(result.status).toBe("timeout");
  }, 10_000);

  it("returns network_error for an unreachable sidecar", async () => {
    const result = await renderPage(unreachableOrigin, "https://example.com/product");
    expect(result.status).toBe("network_error");
    if (result.status === "network_error") {
      expect(result.error).toContain("renderer unreachable");
    }
  });

  it("returns network_error for an unparseable base URL", async () => {
    const result = await renderPage("not a url", "https://example.com/product");
    expect(result.status).toBe("network_error");
  });

  it("never throws, across sidecar failures, transport failures, and bad input", async () => {
    const attempts = [
      () => renderPage(origin, "https://example.com/mode-500"),
      () => renderPage(origin, "https://example.com/mode-429"),
      () => renderPage(origin, "https://example.com/mode-malformed-json"),
      () => renderPage(origin, "https://example.com/mode-hang", { timeoutMs: 50 }),
      () => renderPage(unreachableOrigin, "https://example.com/product"),
      () => renderPage("not a url", "https://example.com/product"),
    ];
    for (const attempt of attempts) {
      // biome-ignore lint/performance/noAwaitInLoops: sequential by design, this is asserting each attempt individually resolves rather than throws.
      await expect(attempt()).resolves.toBeDefined();
    }
  }, 15_000);
});
