import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ALLOWED_PRIVATE_HOSTS_ENV } from "../net/guard";
import {
  domainQueueCount,
  fetchPage,
  hostnameKey,
  isRetryableStatus,
  retryDelayMs,
  withDomainQueue,
} from "./index";

describe("hostnameKey", () => {
  it("lowercases the hostname", () => {
    expect(hostnameKey("https://Shop.Example.COM/item/1")).toBe("shop.example.com");
  });

  it("strips a leading www", () => {
    expect(hostnameKey("https://www.example.com/item/1")).toBe("example.com");
  });

  it("keeps www elsewhere in the hostname", () => {
    expect(hostnameKey("https://www2.example.com/item")).toBe("www2.example.com");
  });

  it("ignores port, path, and query", () => {
    expect(hostnameKey("http://example.com:8080/a/b?c=d")).toBe("example.com");
  });

  it("throws on an invalid URL", () => {
    expect(() => hostnameKey("not a url")).toThrow();
  });
});

describe("isRetryableStatus", () => {
  it("retries 429 and 5xx", () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
  });

  it("does not retry 4xx other than 429", () => {
    expect(isRetryableStatus(404)).toBe(false);
    expect(isRetryableStatus(403)).toBe(false);
    expect(isRetryableStatus(200)).toBe(false);
  });
});

describe("retryDelayMs", () => {
  it("grows exponentially and stays within the jitter band", () => {
    for (const [attempt, base] of [
      [0, 1000],
      [1, 2000],
      [2, 4000],
    ] as const) {
      const delay = retryDelayMs(attempt);
      expect(delay).toBeGreaterThanOrEqual(base);
      expect(delay).toBeLessThanOrEqual(base * 1.25);
    }
  });

  it("caps the exponential growth", () => {
    expect(retryDelayMs(20)).toBeLessThanOrEqual(12_500);
  });

  it("honours a numeric Retry-After", () => {
    expect(retryDelayMs(0, "3")).toBe(3000);
  });

  it("caps an absurd Retry-After", () => {
    expect(retryDelayMs(0, "9999")).toBe(30_000);
  });

  it("honours an HTTP-date Retry-After", () => {
    const retryAt = new Date(Date.now() + 5000).toUTCString();
    const delay = retryDelayMs(0, retryAt);
    expect(delay).toBeGreaterThan(3000);
    expect(delay).toBeLessThanOrEqual(5000);
  });

  it("caps a far-future HTTP-date Retry-After", () => {
    const retryAt = new Date(Date.now() + 120_000).toUTCString();
    expect(retryDelayMs(0, retryAt)).toBe(30_000);
  });

  it("treats a past HTTP-date Retry-After as retry now", () => {
    expect(retryDelayMs(0, new Date(Date.now() - 60_000).toUTCString())).toBe(0);
  });

  it("falls back to exponential backoff for an unparsable Retry-After", () => {
    const delay = retryDelayMs(0, "soonish");
    expect(delay).toBeGreaterThanOrEqual(1000);
    expect(delay).toBeLessThanOrEqual(1250);
  });
});

/** Records what the client actually sent, so header behaviour is observable. */
interface Recorded {
  headers: IncomingMessage["headers"];
  url: string | undefined;
}

describe("fetchPage", () => {
  let server: Server;
  let origin: string;
  const requests: Recorded[] = [];
  let hits = 0;
  let inFlight = 0;
  let maxConcurrent = 0;

  const handlers: Record<string, (res: ServerResponse, req: IncomingMessage) => void> = {
    "/always-429": (res) => {
      hits += 1;
      res.writeHead(429, { "retry-after": "0" });
      res.end("slow down");
    },
    // res.write (rather than a single res.end) forces chunked transfer
    // encoding, so these responses carry no Content-Length header.
    "/chunked": (res) => {
      res.writeHead(200);
      res.write("<html>");
      res.write("chunked");
      res.end("</html>");
    },
    "/chunked-big": (res) => {
      res.writeHead(200);
      for (let i = 0; i < 40; i += 1) {
        res.write("x".repeat(1000));
      }
      res.end();
    },
    "/conditional": (res, req) => {
      if (req.headers["if-none-match"] === '"abc123"') {
        res.writeHead(304, { etag: '"abc123"' });
        res.end();
        return;
      }
      res.writeHead(200, { etag: '"abc123"' });
      res.end("<html>fresh</html>");
    },
    "/flaky": (res) => {
      hits += 1;
      if (hits < 3) {
        res.writeHead(503, { "retry-after": "0" });
        res.end("try later");
        return;
      }
      res.writeHead(200);
      res.end("<html>recovered</html>");
    },
    "/missing": (res) => {
      res.writeHead(404);
      res.end("nope");
    },
    "/multibyte": (res) => {
      // 10 characters, 30 UTF-8 bytes, sent without a Content-Length header.
      res.writeHead(200);
      res.write("€".repeat(10));
      res.end();
    },
    "/ok": (res) => {
      res.writeHead(200, {
        "content-type": "text/html",
        etag: '"abc123"',
        "last-modified": "Wed, 21 Oct 2026 07:28:00 GMT",
      });
      res.end("<html><body>hello</body></html>");
    },
    "/serial": (res) => {
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      setTimeout(() => {
        inFlight -= 1;
        res.writeHead(200);
        res.end("<html>serial</html>");
      }, 60);
    },
    "/slow": (res) => {
      setTimeout(() => {
        res.writeHead(200);
        res.end("<html>late</html>");
      }, 1000);
    },
  };

  beforeAll(async () => {
    // Every case below fetches from a loopback server, which the address guard
    // blocks by default. The exemption is set here rather than the guard being
    // relaxed, so these tests exercise the same code path a self-hosted
    // deployment scraping its own LAN does.
    process.env[ALLOWED_PRIVATE_HOSTS_ENV] = "127.0.0.1";
    server = createServer((req, res) => {
      requests.push({ headers: req.headers, url: req.url });
      const path = (req.url ?? "").split("?")[0] ?? "";
      const handler = handlers[path];
      if (handler) {
        handler(res, req);
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const { port } = server.address() as AddressInfo;
    origin = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    // `delete`, not an assignment: writing `undefined` into process.env stores
    // the four-character string "undefined".
    delete process.env[ALLOWED_PRIVATE_HOSTS_ENV];
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("returns the body plus the conditional-request headers", async () => {
    const result = await fetchPage(`${origin}/ok`);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      return;
    }
    expect(result.body).toContain("hello");
    expect(result.httpStatus).toBe(200);
    expect(result.etag).toBe('"abc123"');
    expect(result.lastModified).toBe("Wed, 21 Oct 2026 07:28:00 GMT");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("sends realistic browser headers", async () => {
    requests.length = 0;
    await fetchPage(`${origin}/ok`);
    const sent = requests.at(-1);
    expect(sent?.headers["user-agent"]).toContain("Mozilla/5.0");
    expect(sent?.headers["accept-language"]).toBe("en-GB,en;q=0.9");
    expect(sent?.headers.accept).toContain("text/html");
  });

  it("sends a custom Accept-Language when asked", async () => {
    requests.length = 0;
    await fetchPage(`${origin}/ok`, { acceptLanguage: "de-DE,de;q=0.9" });
    expect(requests.at(-1)?.headers["accept-language"]).toBe("de-DE,de;q=0.9");
  });

  it("sends If-None-Match and reports a 304 as not_modified", async () => {
    requests.length = 0;
    const result = await fetchPage(`${origin}/conditional`, { etag: '"abc123"' });
    expect(requests.at(-1)?.headers["if-none-match"]).toBe('"abc123"');
    expect(result.status).toBe("not_modified");
    if (result.status === "not_modified") {
      expect(result.httpStatus).toBe(304);
      expect(result.etag).toBe('"abc123"');
    }
  });

  it("sends If-Modified-Since when given a last-modified value", async () => {
    requests.length = 0;
    await fetchPage(`${origin}/ok`, { lastModified: "Wed, 21 Oct 2026 07:28:00 GMT" });
    expect(requests.at(-1)?.headers["if-modified-since"]).toBe("Wed, 21 Oct 2026 07:28:00 GMT");
  });

  it("reports a 404 as http_error without retrying", async () => {
    requests.length = 0;
    const result = await fetchPage(`${origin}/missing`);
    expect(result.status).toBe("http_error");
    if (result.status === "http_error") {
      expect(result.httpStatus).toBe(404);
      expect(result.error).toContain("404");
    }
    expect(requests).toHaveLength(1);
  });

  it("retries a 503 and succeeds on the third attempt", async () => {
    hits = 0;
    const result = await fetchPage(`${origin}/flaky`);
    expect(hits).toBe(3);
    expect(result.status).toBe("ok");
  });

  it("gives up after maxRetries on a persistent 429", async () => {
    hits = 0;
    const result = await fetchPage(`${origin}/always-429`, { maxRetries: 1 });
    expect(hits).toBe(2);
    expect(result.status).toBe("http_error");
    if (result.status === "http_error") {
      expect(result.httpStatus).toBe(429);
    }
  });

  it("times out rather than hanging", async () => {
    const result = await fetchPage(`${origin}/slow`, { maxRetries: 0, timeoutMs: 150 });
    expect(result.status).toBe("timeout");
    if (result.status === "timeout") {
      expect(result.error).toContain("150ms");
    }
  });

  it("rejects a body larger than maxBytes", async () => {
    const result = await fetchPage(`${origin}/ok`, { maxBytes: 5 });
    expect(result.status).toBe("http_error");
    if (result.status === "http_error") {
      expect(result.error).toContain("too large");
    }
  });

  it("streams a chunked body with no Content-Length", async () => {
    const result = await fetchPage(`${origin}/chunked`);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.body).toBe("<html>chunked</html>");
    }
  });

  it("aborts a chunked body once it passes maxBytes", async () => {
    const result = await fetchPage(`${origin}/chunked-big`, { maxBytes: 2500 });
    expect(result.status).toBe("http_error");
    if (result.status === "http_error") {
      expect(result.httpStatus).toBe(200);
      expect(result.error).toContain("too large");
    }
  });

  it("counts bytes, not UTF-16 code units, against maxBytes", async () => {
    // 10 code units but 30 bytes: a code-unit cap would let this through.
    const result = await fetchPage(`${origin}/multibyte`, { maxBytes: 15 });
    expect(result.status).toBe("http_error");
    if (result.status === "http_error") {
      expect(result.error).toContain("too large");
    }
  });

  it("decodes a multibyte body that fits maxBytes exactly", async () => {
    const result = await fetchPage(`${origin}/multibyte`, { maxBytes: 30 });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.body).toBe("€".repeat(10));
    }
  });

  it("runs at most one request per domain at a time", async () => {
    inFlight = 0;
    maxConcurrent = 0;
    await Promise.all([
      fetchPage(`${origin}/serial`),
      fetchPage(`${origin}/serial`),
      fetchPage(`${origin}/serial`),
    ]);
    expect(maxConcurrent).toBe(1);
  });

  it("evicts the domain queue once no work remains", async () => {
    const first = fetchPage(`${origin}/serial`);
    const second = fetchPage(`${origin}/serial`);
    expect(domainQueueCount()).toBe(1);
    await first;
    // The second request is still queued or in flight, so the queue survives.
    expect(domainQueueCount()).toBe(1);
    await second;
    expect(domainQueueCount()).toBe(0);
  });

  it("returns network_error for an unparseable URL instead of throwing", async () => {
    const result = await fetchPage("not a url");
    expect(result.status).toBe("network_error");
    if (result.status === "network_error") {
      expect(result.error).toContain("invalid URL");
    }
  });
});

describe("withDomainQueue", () => {
  it("serialises two concurrent calls on the same hostname", async () => {
    let inFlight = 0;
    let maxConcurrent = 0;
    const run = () =>
      withDomainQueue("https://queue-test.example.com/a", async () => {
        inFlight += 1;
        maxConcurrent = Math.max(maxConcurrent, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 20));
        inFlight -= 1;
      });
    await Promise.all([run(), run()]);
    expect(maxConcurrent).toBe(1);
  });

  it("evicts the queue once the domain goes idle", async () => {
    const url = "https://queue-eviction-test.example.com/a";
    const first = withDomainQueue(url, () => new Promise((resolve) => setTimeout(resolve, 10)));
    const second = withDomainQueue(url, () => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(domainQueueCount()).toBeGreaterThan(0);
    await first;
    await second;
    expect(domainQueueCount()).toBe(0);
  });

  it("runs an unparseable URL unqueued rather than throwing", async () => {
    await expect(withDomainQueue("not a url", () => Promise.resolve("ran"))).resolves.toBe("ran");
  });

  it("propagates the callback's return value", async () => {
    const result = await withDomainQueue("https://queue-return-test.example.com/a", () =>
      Promise.resolve(42)
    );
    expect(result).toBe(42);
  });

  it("propagates the callback's rejection", async () => {
    await expect(
      withDomainQueue("https://queue-reject-test.example.com/a", () =>
        Promise.reject(new Error("boom"))
      )
    ).rejects.toThrow("boom");
  });
});
