import dgram from "node:dgram";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { closeBrowser, renderPage } from "./render";

const PRIVATE_HOSTS_ENV = "ALLOWED_PRIVATE_HOSTS";

function listenHttp(
  udpPort: number,
  requests: Map<string, number>,
  upgrades: { count: number }
): Promise<{ close: () => Promise<void>; port: number }> {
  const server = createServer((request, response) => {
    const path = request.url ?? "/";
    requests.set(path, (requests.get(path) ?? 0) + 1);
    if (path === "/styles.css") {
      response.writeHead(200, { "content-type": "text/css" });
      response.end("body { color: rgb(1, 2, 3); }");
      return;
    }
    if (path === "/redirect") {
      const { port } = server.address() as AddressInfo;
      response.writeHead(302, { location: `http://127.0.0.1:${port}/redirect-target` });
      response.end();
      return;
    }
    if (path === "/allow") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<!doctype html>
        <body data-popup="pending" data-ready="pending">
          <script>
            const sheet = document.createElement("link");
            sheet.rel = "stylesheet";
            sheet.href = "/styles.css";
            sheet.addEventListener("load", () => { document.body.dataset.ready = "stylesheet"; });
            document.head.append(sheet);
            navigator.serviceWorker.register("/sw.js").catch(() => undefined);
            new WebSocket("ws://localhost:${(server.address() as AddressInfo).port}/socket");
            const peer = new RTCPeerConnection({
              iceServers: [{ urls: "stun:127.0.0.1:${udpPort}" }],
            });
            peer.createDataChannel("probe");
            peer.createOffer().then((offer) => peer.setLocalDescription(offer)).catch(() => undefined);
            const popup = window.open("/popup");
            const popupCheck = setInterval(() => {
              if (!popup || popup.closed) {
                clearInterval(popupCheck);
                document.body.dataset.popup = "contained";
              }
            }, 10);
          </script>
        </body>`);
      return;
    }
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("unexpected private request");
  });
  server.on("upgrade", (_request, socket) => {
    upgrades.count += 1;
    socket.destroy();
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

function listenUdp(packets: { count: number }): Promise<{ close: () => void; port: number }> {
  const socket = dgram.createSocket("udp4");
  socket.on("message", () => {
    packets.count += 1;
  });
  return new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(0, "127.0.0.1", () => {
      socket.off("error", reject);
      const { port } = socket.address();
      resolve({ close: () => socket.close(), port });
    });
  });
}

afterAll(async () => {
  await closeBrowser();
});

describe("real Chromium egress policy", () => {
  it("pins browser traffic to the guard and disables side channels", async () => {
    const previousAllowlist = process.env[PRIVATE_HOSTS_ENV];
    process.env[PRIVATE_HOSTS_ENV] = "localhost";
    const requests = new Map<string, number>();
    const upgrades = { count: 0 };
    const packets = { count: 0 };
    const udp = await listenUdp(packets);
    const http = await listenHttp(udp.port, requests, upgrades);

    try {
      const allowed = await renderPage({
        timeoutMs: 10_000,
        url: `http://localhost:${http.port}/allow`,
        waitUntil: "load",
      });
      expect(allowed.status).toBe("ok");
      expect(allowed.status === "ok" ? allowed.html : "").toContain('data-ready="stylesheet"');
      expect(allowed.status === "ok" ? allowed.html : "").toContain('data-popup="contained"');

      const blocked = await renderPage({ url: `http://127.0.0.1:${http.port}/blocked` });
      expect(blocked.status).toBe("network_error");

      const redirected = await renderPage({ url: `http://localhost:${http.port}/redirect` });
      expect(redirected.status).toBe("network_error");

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(requests.get("/blocked") ?? 0).toBe(0);
      expect(requests.get("/redirect-target") ?? 0).toBe(0);
      expect(requests.get("/sw.js") ?? 0).toBe(0);
      expect(upgrades.count).toBe(0);
      expect(packets.count).toBe(0);
    } finally {
      udp.close();
      await http.close();
      if (previousAllowlist === undefined) {
        delete process.env[PRIVATE_HOSTS_ENV];
      } else {
        process.env[PRIVATE_HOSTS_ENV] = previousAllowlist;
      }
    }
  }, 30_000);
});
