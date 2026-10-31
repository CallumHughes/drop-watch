import { afterEach, expect, it, vi } from "vitest";
import { browserStatus, closeBrowser, renderPage } from "./render";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  launchServer: vi.fn(),
}));

vi.mock("playwright", () => ({ chromium: mocks }));
vi.mock("./guarded-socks-proxy", () => ({
  startGuardedSocksProxy: async () => ({
    abort: vi.fn(),
    refusal: () => null,
    server: "socks5://localhost:1234",
  }),
}));

afterEach(async () => {
  await closeBrowser();
  vi.useRealTimers();
});

it("keeps a slow cold launch usable when identity detection needs its fallback", async () => {
  vi.useFakeTimers();
  const server = {
    close: vi.fn(async () => undefined),
    kill: vi.fn(async () => undefined),
    process: () => ({ exitCode: null, signalCode: null }),
    wsEndpoint: () => "ws://localhost/browser",
  };
  const probeContext = {
    close: vi.fn(async () => undefined),
    newPage: async () => ({
      evaluate: vi.fn().mockResolvedValueOnce(null).mockResolvedValue("Chrome/156.0.0.0"),
      goto: async () => await new Promise((resolve) => setTimeout(resolve, 5000)),
    }),
    route: async () => undefined,
  };
  const send = vi.fn(async () => undefined);
  const renderContext = {
    close: vi.fn(async () => undefined),
    newCDPSession: async () => ({ send }),
    newPage: async () => ({
      content: async () => "<p>Product</p>",
      goto: async () => ({ ok: () => true, status: () => 200 }),
      url: () => "https://shop.test/product",
      waitForLoadState: async () => undefined,
    }),
    on: vi.fn(),
    route: async () => undefined,
    routeWebSocket: async () => undefined,
  };
  const browser = {
    isConnected: () => true,
    newContext: vi.fn().mockResolvedValueOnce(probeContext).mockResolvedValue(renderContext),
    version: () => "156.0.8078.4",
  };
  mocks.launchServer.mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, 9990));
    return server;
  });
  mocks.connect.mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, 2990));
    return browser;
  });

  const pending = renderPage({ url: "https://shop.test/product" }).then(
    (result) => ({ result }),
    (error: unknown) => ({ error })
  );
  await vi.advanceTimersByTimeAsync(16_000);

  expect(await pending).toMatchObject({ result: { status: "ok" } });
  expect(browserStatus()).toBe("connected");
  // The probe never answered, so the brand list is composed rather than read —
  // but it is still sent. Skipping it would leave Chromium announcing
  // `HeadlessChrome` in `Sec-CH-UA` behind a user agent claiming otherwise.
  expect(send).toHaveBeenCalledWith(
    "Emulation.setUserAgentOverride",
    expect.objectContaining({
      userAgentMetadata: expect.objectContaining({
        brands: [
          { brand: "Chromium", version: "156" },
          { brand: "Google Chrome", version: "156" },
        ],
        platform: "macOS",
      }),
    })
  );
  expect(server.close).not.toHaveBeenCalled();
  expect(server.kill).not.toHaveBeenCalled();
  expect(renderContext.close).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(2000);
  expect(probeContext.close).toHaveBeenCalledOnce();
});
