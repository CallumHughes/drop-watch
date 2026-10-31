import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { closeBrowser, renderPage } from "./render";

const PRIVATE_HOSTS_ENV = "ALLOWED_PRIVATE_HOSTS";

interface Observed {
  acceptLanguage: string | undefined;
  secChUa: string | undefined;
  userAgent: string | undefined;
}

/**
 * Echoes back what the browser revealed about itself: the request headers go to
 * `observed`, and the page reports its own `navigator` values into the DOM so a
 * render can assert on them.
 */
function listenEcho(observed: Observed): Promise<{ close: () => Promise<void>; port: number }> {
  const server = createServer((request, response) => {
    observed.userAgent = request.headers["user-agent"];
    observed.acceptLanguage = request.headers["accept-language"];
    observed.secChUa = request.headers["sec-ch-ua"] as string | undefined;
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html><html><body><div id="probe"></div><script>
      document.getElementById('probe').setAttribute('data-webdriver', String(navigator.webdriver));
      document.getElementById('probe').setAttribute('data-ua', navigator.userAgent);
      document.getElementById('probe').setAttribute('data-language', navigator.language);
      document.getElementById('probe').setAttribute(
        'data-timezone',
        Intl.DateTimeFormat().resolvedOptions().timeZone
      );
    </script></body></html>`);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      server.off("error", reject);
      const { port } = server.address() as AddressInfo;
      resolve({
        close: async () => {
          await new Promise<void>((finish, fail) => {
            server.close((error) => (error ? fail(error) : finish()));
          });
        },
        port,
      });
    });
  });
}

async function render(request: { locale?: string; url: string; userAgent?: string }) {
  const result = await renderPage({ timeoutMs: 15_000, waitUntil: "load", ...request });
  if (result.status !== "ok") {
    throw new Error(`render failed: ${result.status}`);
  }
  return result.html;
}

afterAll(async () => {
  await closeBrowser();
});

describe("real Chromium identity", () => {
  /**
   * The headless marker is the whole reason browser mode used to fail: Imperva
   * refuses `HeadlessChrome` on the first document request, before any page
   * JavaScript runs, so no amount of waiting or extraction work recovers it.
   */
  it("presents as an ordinary Chrome and does not advertise automation", async () => {
    const previousAllowlist = process.env[PRIVATE_HOSTS_ENV];
    process.env[PRIVATE_HOSTS_ENV] = "localhost";
    const observed: Observed = {
      acceptLanguage: undefined,
      secChUa: undefined,
      userAgent: undefined,
    };
    const server = await listenEcho(observed);

    try {
      const html = await render({ url: `http://localhost:${server.port}/` });

      expect(observed.userAgent).toBeDefined();
      expect(observed.userAgent).not.toContain("Headless");
      expect(observed.userAgent).toContain("Chrome/");
      // Overriding the user agent does not touch this header — Chromium builds
      // it from its own brand list — so a headless build announces
      // `"HeadlessChrome"` here unless the brand list is replaced too. This is
      // the assertion that catches that, and it fails on a context `userAgent`
      // alone.
      expect(observed.secChUa).toBeDefined();
      expect(observed.secChUa).not.toContain("Headless");
      expect(observed.secChUa).toContain("Google Chrome");
      expect(html).toContain('data-ua="Mozilla/5.0');
      expect(html).not.toContain("HeadlessChrome");
      // `--disable-blink-features=AutomationControlled` is what makes this
      // false; left true, a challenge script withholds its cookie and leaves
      // us on an interstitial even once the user agent passes.
      expect(html).not.toContain('data-webdriver="true"');
      // A browser whose timezone disagrees with its language is a cheap tell,
      // so both defaults are asserted together.
      expect(html).toContain('data-language="en-GB"');
      expect(html).toContain('data-timezone="Europe/London"');
      expect(observed.acceptLanguage).toContain("en-GB");
    } finally {
      await server.close();
      if (previousAllowlist === undefined) {
        delete process.env[PRIVATE_HOSTS_ENV];
      } else {
        process.env[PRIVATE_HOSTS_ENV] = previousAllowlist;
      }
    }
  }, 40_000);

  it("still lets a caller override the identity per request", async () => {
    const previousAllowlist = process.env[PRIVATE_HOSTS_ENV];
    process.env[PRIVATE_HOSTS_ENV] = "localhost";
    const observed: Observed = {
      acceptLanguage: undefined,
      secChUa: undefined,
      userAgent: undefined,
    };
    const server = await listenEcho(observed);

    try {
      const html = await render({
        locale: "de-DE",
        url: `http://localhost:${server.port}/`,
        userAgent: "DropWatch/1.0 (test)",
      });

      expect(observed.userAgent).toBe("DropWatch/1.0 (test)");
      expect(html).toContain('data-language="de-DE"');
      expect(html).toContain('data-timezone="Europe/Berlin"');
      expect(observed.acceptLanguage).toContain("de-DE");
    } finally {
      await server.close();
      if (previousAllowlist === undefined) {
        delete process.env[PRIVATE_HOSTS_ENV];
      } else {
        process.env[PRIVATE_HOSTS_ENV] = previousAllowlist;
      }
    }
  }, 40_000);
});
