import { describe, expect, it } from "vitest";
import { BrowserGenerationManager, withDeadline } from "./browser-generation";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

describe("withDeadline", () => {
  it("rejects without waiting for a promise that never settles", async () => {
    await expect(withDeadline(new Promise(() => undefined), 5, "test")).rejects.toMatchObject({
      name: "TimeoutError",
    });
  });
});

describe("BrowserGenerationManager", () => {
  it("shares a cold launch between concurrent acquires", async () => {
    const launch = deferred<{ connected: boolean }>();
    let launchCalls = 0;
    const manager = new BrowserGenerationManager({
      close: async () => undefined,
      closeTimeoutMs: 10,
      forceClose: async () => undefined,
      forceCloseTimeoutMs: 10,
      isUsable: (handle) => handle.connected,
      launch: async () => {
        launchCalls += 1;
        return await launch.promise;
      },
      launchTimeoutMs: 100,
    });

    const first = manager.acquire();
    const second = manager.acquire();
    launch.resolve({ connected: true });
    const [a, b] = await Promise.all([first, second]);

    expect(launchCalls).toBe(1);
    expect(a.generation).toBe(b.generation);
  });

  it("retires a timed-out launch and closes a late completion", async () => {
    const launch = deferred<{ connected: boolean }>();
    const closed: { connected: boolean }[] = [];
    const manager = new BrowserGenerationManager({
      close: (handle) => {
        closed.push(handle);
        return Promise.resolve();
      },
      closeTimeoutMs: 10,
      forceClose: async () => undefined,
      forceCloseTimeoutMs: 10,
      isUsable: (handle) => handle.connected,
      launch: async () => await launch.promise,
      launchTimeoutMs: 5,
    });

    await expect(manager.acquire()).rejects.toMatchObject({ name: "TimeoutError" });
    launch.resolve({ connected: true });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(manager.isConnected()).toBe(false);
    expect(closed).toHaveLength(1);
  });

  it("closes once when shutdown retires an in-progress launch", async () => {
    const launch = deferred<{ connected: boolean }>();
    let closeCalls = 0;
    const manager = new BrowserGenerationManager({
      close: () => {
        closeCalls += 1;
        return Promise.resolve();
      },
      closeTimeoutMs: 10,
      forceClose: async () => undefined,
      forceCloseTimeoutMs: 10,
      isUsable: (handle) => handle.connected,
      launch: async () => await launch.promise,
      launchTimeoutMs: 100,
    });

    const pending = manager.acquire();
    const shutdown = manager.close();
    launch.resolve({ connected: true });

    await expect(pending).rejects.toThrow("retired during launch");
    await shutdown;
    expect(closeCalls).toBe(1);
  });

  it("detaches before bounded shutdown even when launch never settles", async () => {
    const manager = new BrowserGenerationManager({
      close: async () => undefined,
      closeTimeoutMs: 5,
      forceClose: async () => undefined,
      forceCloseTimeoutMs: 5,
      isUsable: (handle) => handle.connected,
      launch: async () => await new Promise<{ connected: boolean }>(() => undefined),
      launchTimeoutMs: 5,
    });

    const pending = manager.acquire().then(
      () => null,
      (error) => error
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const started = Date.now();
    await manager.close();

    expect(Date.now() - started).toBeLessThan(50);
    expect(manager.isConnected()).toBe(false);
    await expect(pending).resolves.toMatchObject({ name: "TimeoutError" });
  });

  it("force-closes once when graceful close misses its deadline", async () => {
    let forceCloseCalls = 0;
    const manager = new BrowserGenerationManager({
      close: async () => await new Promise<void>(() => undefined),
      closeTimeoutMs: 5,
      forceClose: () => {
        forceCloseCalls += 1;
        return Promise.resolve();
      },
      forceCloseTimeoutMs: 10,
      isUsable: (handle) => handle.connected,
      launch: async () => ({ connected: true }),
      launchTimeoutMs: 20,
    });

    const { generation } = await manager.acquire();
    manager.retire(generation);
    await generation.closePromise;

    expect(forceCloseCalls).toBe(1);
  });

  it("does not launch a new generation after shutdown starts", async () => {
    let launchCalls = 0;
    const manager = new BrowserGenerationManager({
      close: async () => undefined,
      closeTimeoutMs: 5,
      forceClose: async () => undefined,
      forceCloseTimeoutMs: 5,
      isUsable: (handle) => handle.connected,
      launch: () => {
        launchCalls += 1;
        return Promise.resolve({ connected: true });
      },
      launchTimeoutMs: 5,
    });

    await manager.close();

    await expect(manager.acquire()).rejects.toThrow("browser manager is closed");
    expect(launchCalls).toBe(0);
  });
});
