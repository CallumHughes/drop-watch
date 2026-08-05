import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { fetchPage } from "../fetch/index";
import {
  ALLOWED_PRIVATE_HOSTS_ENV,
  allowedPrivateHosts,
  checkHostAddresses,
  checkPeerAddress,
  checkUrl,
  checkUrlScheme,
  isAllowedPrivateHost,
} from "./guard";

function allow(value: string | null): void {
  if (value === null) {
    delete process.env[ALLOWED_PRIVATE_HOSTS_ENV];
    return;
  }
  process.env[ALLOWED_PRIVATE_HOSTS_ENV] = value;
}

afterEach(() => {
  allow(null);
});

describe("checkUrlScheme", () => {
  it("accepts http and https", () => {
    expect(checkUrlScheme("http://example.com/p")).toEqual({ ok: true });
    expect(checkUrlScheme("https://example.com/p")).toEqual({ ok: true });
  });

  it("refuses the schemes a syntactic URL check lets through", () => {
    for (const url of ["file:///etc/passwd", "javascript:alert(1)", "ftp://example.com/x"]) {
      const verdict = checkUrlScheme(url);
      expect(verdict.ok, url).toBe(false);
      if (!verdict.ok) {
        expect(verdict.reason).toContain("refusing to fetch");
      }
    }
  });

  it("reports an unparseable URL rather than throwing", () => {
    const verdict = checkUrlScheme("not a url");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toContain("invalid URL");
    }
  });
});

describe("allowedPrivateHosts", () => {
  it("is empty when the variable is unset", () => {
    allow(null);
    expect(allowedPrivateHosts().size).toBe(0);
  });

  it("splits, trims and lowercases", () => {
    allow(" Localhost , 10.0.0.5 ,, fixture.internal ");
    expect([...allowedPrivateHosts()]).toEqual(["localhost", "10.0.0.5", "fixture.internal"]);
  });

  it("re-reads when the variable changes", () => {
    allow("localhost");
    expect(isAllowedPrivateHost("localhost")).toBe(true);
    allow("other.host");
    expect(isAllowedPrivateHost("localhost")).toBe(false);
    expect(isAllowedPrivateHost("other.host")).toBe(true);
  });

  it("matches a bracketed IPv6 host against an unbracketed entry", () => {
    allow("::1");
    expect(isAllowedPrivateHost("[::1]")).toBe(true);
  });
});

describe("checkHostAddresses", () => {
  it("refuses a name that resolves to loopback", async () => {
    const verdict = await checkHostAddresses("localhost");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toContain("not public");
    }
  });

  it("refuses a literal private address", async () => {
    await expect(checkHostAddresses("169.254.169.254")).resolves.toEqual({
      ok: false,
      reason: "169.254.169.254 resolves to 169.254.169.254, which is not public",
    });
  });

  it("allows a literal public address", async () => {
    await expect(checkHostAddresses("1.1.1.1")).resolves.toEqual({ ok: true });
  });

  it("honours the allowlist", async () => {
    allow("localhost");
    await expect(checkHostAddresses("localhost")).resolves.toEqual({ ok: true });
  });

  it("reports a name that does not resolve", async () => {
    const verdict = await checkHostAddresses("no-such-host.invalid");
    expect(verdict.ok).toBe(false);
  });
});

describe("checkUrl", () => {
  it("fails on the scheme before it ever resolves", async () => {
    const verdict = await checkUrl("file:///etc/passwd");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toContain("refusing to fetch");
    }
  });

  it("fails on the address when the scheme is fine", async () => {
    const verdict = await checkUrl("http://127.0.0.1:8080/admin");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toContain("not public");
    }
  });
});

describe("checkPeerAddress", () => {
  it("accepts a public peer", () => {
    expect(checkPeerAddress("93.184.216.34", "example.com")).toEqual({ ok: true });
  });

  it("catches a host that resolved public and served from private", () => {
    const verdict = checkPeerAddress("127.0.0.1", "rebind.example");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toContain("was served from 127.0.0.1");
    }
  });

  it("honours the allowlist", () => {
    allow("fixture.internal");
    expect(checkPeerAddress("10.1.2.3", "fixture.internal")).toEqual({ ok: true });
  });
});

/**
 * The guard's real contract: not "does the helper return false" but "does
 * `fetchPage` actually decline to talk to the host". The server is started so
 * that a failure to block would succeed loudly rather than fail for some
 * unrelated connection reason.
 */
describe("fetchPage against a loopback server", () => {
  let server: Server;
  let origin: string;

  const start = async () => {
    server = createServer((req, res) => {
      if (req.url === "/redirect") {
        res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html>internal</html>");
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  };

  const stop = () =>
    new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });

  it("refuses to connect when the host is not allowlisted", async () => {
    await start();
    try {
      const result = await fetchPage(`${origin}/`, { maxRetries: 0 });
      expect(result.status).toBe("network_error");
      if (result.status === "network_error") {
        expect(result.error).toContain("not a public address");
      }
    } finally {
      await stop();
    }
  });

  it("connects once the host is allowlisted", async () => {
    allow("127.0.0.1");
    await start();
    try {
      const result = await fetchPage(`${origin}/`, { maxRetries: 0 });
      expect(result.status).toBe("ok");
      if (result.status === "ok") {
        expect(result.body).toContain("internal");
      }
    } finally {
      await stop();
    }
  });

  /**
   * The case a pre-flight URL check cannot cover: the first hop is allowed and
   * the second one is the metadata endpoint. `redirect: "follow"` means undici
   * makes that hop itself, so the guard has to sit under it.
   */
  it("refuses a redirect into a private address even from an allowed first hop", async () => {
    allow("127.0.0.1");
    await start();
    try {
      const result = await fetchPage(`${origin}/redirect`, { maxRetries: 0 });
      expect(result.status).toBe("network_error");
      if (result.status === "network_error") {
        expect(result.error).toContain("169.254.169.254");
        expect(result.error).toContain("not a public address");
      }
    } finally {
      await stop();
    }
  });

  it("refuses a non-http scheme without opening a socket", async () => {
    const result = await fetchPage("file:///etc/passwd");
    expect(result.status).toBe("network_error");
    if (result.status === "network_error") {
      expect(result.error).toContain("refusing to fetch");
    }
  });
});
