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
  const renderContext = {
    close: vi.fn(async () => undefined),
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
  expect(server.close).not.toHaveBeenCalled();
  expect(server.kill).not.toHaveBeenCalled();
  expect(renderContext.close).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(2000);
  expect(probeContext.close).toHaveBeenCalledOnce();
});
