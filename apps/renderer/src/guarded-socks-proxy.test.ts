import type { AddressInfo, LookupFunction, NetConnectOpts, TcpNetConnectOpts } from "node:net";
import net from "node:net";
import { BlockedAddressError } from "@drop-watch/core/net/guard";
import { afterEach, describe, expect, it } from "vitest";
import { startGuardedSocksProxy } from "./guarded-socks-proxy";

const ALLOWED_HOSTS_ENV = "ALLOWED_PRIVATE_HOSTS";

function readData(socket: net.Socket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const onData = (chunk: Buffer): void => {
      cleanup();
      resolve(chunk);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onClose = (): void => {
      cleanup();
      reject(new Error("socket closed before data"));
    };
    const cleanup = (): void => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
    };
    socket.once("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

async function listen(): Promise<{ server: net.Server; port: number }> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen({ host: "127.0.0.1", port: 0 }, resolve));
  const address = server.address() as AddressInfo;
  return { port: address.port, server };
}

function connectProxy(proxyServer: string): net.Socket {
  return net.connect(Number(new URL(proxyServer).port), "127.0.0.1");
}

function ipv4Request(address: string, port: number, command = 1): Buffer {
  return Buffer.from([
    5,
    command,
    0,
    1,
    ...address.split(".").map(Number),
    Math.floor(port / 256),
    port % 256,
  ]);
}

function domainRequest(hostname: string, port: number): Buffer {
  const name = Buffer.from(hostname);
  return Buffer.from([5, 1, 0, 3, name.length, ...name, Math.floor(port / 256), port % 256]);
}

async function authenticate(socket: net.Socket): Promise<void> {
  socket.write(Buffer.from([5, 1, 0]));
  await expect(readData(socket)).resolves.toEqual(Buffer.from([5, 0]));
}

afterEach(() => {
  delete process.env[ALLOWED_HOSTS_ENV];
});

describe("startGuardedSocksProxy", () => {
  it("handles fragmented SOCKS5 CONNECT handshakes and tunnels bytes", async () => {
    const target = await listen();
    const received = new Promise<Buffer>((resolve) => {
      target.server.once("connection", (socket) => socket.once("data", resolve));
    });
    const connect = (options: NetConnectOpts): net.Socket =>
      net.connect({ ...options, host: "127.0.0.1" });
    const proxy = await startGuardedSocksProxy({ connect });
    const client = connectProxy(proxy.server);
    await new Promise<void>((resolve) => client.once("connect", resolve));

    client.write(Buffer.from([5]));
    client.write(Buffer.from([1, 0]));
    await expect(readData(client)).resolves.toEqual(Buffer.from([5, 0]));
    const request = ipv4Request("93.184.216.34", target.port);
    for (const byte of request) {
      client.write(Buffer.from([byte]));
    }
    const response = await readData(client);
    expect(response[1]).toBe(0);
    client.write(Buffer.from("hello"));
    await expect(received).resolves.toEqual(Buffer.from("hello"));

    client.destroy();
    target.server.close();
    proxy.abort();
    await proxy.waitClosed(100);
  });

  it("rejects private IPv4 literals before opening an upstream socket", async () => {
    const target = await listen();
    let connections = 0;
    target.server.on("connection", () => {
      connections += 1;
    });
    const proxy = await startGuardedSocksProxy();
    const client = connectProxy(proxy.server);
    await new Promise<void>((resolve) => client.once("connect", resolve));
    await authenticate(client);
    client.write(ipv4Request("127.0.0.1", target.port));
    const response = await readData(client);

    expect(response[1]).toBe(2);
    expect(proxy.refusal()).toContain("127.0.0.1");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(connections).toBe(0);

    client.destroy();
    target.server.close();
    proxy.abort();
    await proxy.waitClosed(100);
  });

  it("survives a client reset after denying a blocked target", async () => {
    const proxy = await startGuardedSocksProxy();
    const deniedClient = connectProxy(proxy.server);
    deniedClient.on("error", () => undefined);
    await new Promise<void>((resolve) => deniedClient.once("connect", resolve));
    await authenticate(deniedClient);
    deniedClient.write(ipv4Request("127.0.0.1", 80));
    const response = await readData(deniedClient);
    expect(response[1]).toBe(2);

    const deniedClosed = new Promise<void>((resolve) => deniedClient.once("close", resolve));
    deniedClient.resetAndDestroy();
    await deniedClosed;

    const nextClient = connectProxy(proxy.server);
    await new Promise<void>((resolve) => nextClient.once("connect", resolve));
    await authenticate(nextClient);
    nextClient.destroy();

    proxy.abort();
    await proxy.waitClosed(100);
  });

  it("sends only the greeting rejection when no supported authentication method exists", async () => {
    const proxy = await startGuardedSocksProxy();
    const client = connectProxy(proxy.server);
    await new Promise<void>((resolve) => client.once("connect", resolve));
    const response = new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      client.on("data", (chunk) => chunks.push(chunk));
      client.once("error", reject);
      client.once("close", () => resolve(Buffer.concat(chunks)));
    });

    client.write(Buffer.from([5, 1, 2]));

    await expect(response).resolves.toEqual(Buffer.from([5, 0xff]));
    proxy.abort();
    await proxy.waitClosed(100);
  });

  it("rejects BIND and UDP ASSOCIATE without connecting upstream", async () => {
    const target = await listen();
    const proxy = await startGuardedSocksProxy();
    const client = connectProxy(proxy.server);
    await new Promise<void>((resolve) => client.once("connect", resolve));
    await authenticate(client);

    client.write(ipv4Request("93.184.216.34", target.port, 2));
    const response = await readData(client);
    expect(response[1]).toBe(7);

    client.destroy();
    target.server.close();
    proxy.abort();
    await proxy.waitClosed(100);
  });

  it("rejects malformed oversized domain requests", async () => {
    const proxy = await startGuardedSocksProxy();
    const client = connectProxy(proxy.server);
    await new Promise<void>((resolve) => client.once("connect", resolve));
    await authenticate(client);

    client.write(Buffer.from([5, 1, 0, 3, 254]));
    const response = await readData(client);
    expect(response[1]).toBe(8);

    client.destroy();
    proxy.abort();
    await proxy.waitClosed(100);
  });

  it("uses the supplied guarded lookup for hostnames and preserves its refusal", async () => {
    let connectCalls = 0;
    const lookup: LookupFunction = (_hostname, _options, callback) => {
      connectCalls += 1;
      callback(new BlockedAddressError("private.test", "127.0.0.1"), "");
    };
    const proxy = await startGuardedSocksProxy({ lookup });
    const client = connectProxy(proxy.server);
    await new Promise<void>((resolve) => client.once("connect", resolve));
    await authenticate(client);

    client.write(domainRequest("private.test", 80));
    const response = await readData(client);
    expect(response[1]).toBe(2);
    expect(connectCalls).toBe(1);
    expect(proxy.refusal()).toContain("private.test");

    client.destroy();
    proxy.abort();
    await proxy.waitClosed(100);
  });

  it("allows an explicitly allowlisted hostname to reach a private target", async () => {
    process.env[ALLOWED_HOSTS_ENV] = "allowed.test";
    const target = await listen();
    const received = new Promise<Buffer>((resolve) => {
      target.server.once("connection", (socket) => socket.once("data", resolve));
    });
    const lookup: LookupFunction = (_hostname, options, callback) => {
      if ("all" in options && options.all) {
        callback(null, [{ address: "127.0.0.1", family: 4 }]);
        return;
      }
      callback(null, "127.0.0.1", 4);
    };
    const proxy = await startGuardedSocksProxy({ lookup });
    const client = connectProxy(proxy.server);
    await new Promise<void>((resolve) => client.once("connect", resolve));
    await authenticate(client);
    client.write(domainRequest("allowed.test", target.port));
    const response = await readData(client);
    expect(response[1]).toBe(0);
    client.write(Buffer.from("hello"));
    await expect(received).resolves.toEqual(Buffer.from("hello"));

    client.destroy();
    target.server.close();
    proxy.abort();
    await proxy.waitClosed(100);
  });

  it("pins the one approved DNS answer to the upstream socket", async () => {
    const target = await listen();
    const received = new Promise<Buffer>((resolve) => {
      target.server.once("connection", (socket) => socket.once("data", resolve));
    });
    let lookupCalls = 0;
    const lookup: LookupFunction = (_hostname, options, callback) => {
      lookupCalls += 1;
      const address = lookupCalls === 1 ? "127.0.0.1" : "169.254.169.254";
      if ("all" in options && options.all) {
        callback(null, [{ address, family: 4 }]);
        return;
      }
      callback(null, address, 4);
    };
    const proxy = await startGuardedSocksProxy({ lookup });
    const client = connectProxy(proxy.server);
    await new Promise<void>((resolve) => client.once("connect", resolve));
    await authenticate(client);

    client.write(domainRequest("rebind.test", target.port));
    const response = await readData(client);
    expect(response[1]).toBe(0);
    client.write(Buffer.from("pinned"));
    await expect(received).resolves.toEqual(Buffer.from("pinned"));
    expect(lookupCalls).toBe(1);

    client.destroy();
    target.server.close();
    proxy.abort();
    await proxy.waitClosed(100);
  });

  it("does not revive an upstream connection that settles after abort", async () => {
    const upstream = new net.Socket();
    const originalDestroy = upstream.destroy.bind(upstream);
    let destroyCalls = 0;
    upstream.destroy = ((error?: Error) => {
      destroyCalls += 1;
      return originalDestroy(error);
    }) as net.Socket["destroy"];

    let releaseLookup: (() => void) | undefined;
    let notifyLookupStarted: (() => void) | undefined;
    const lookupStarted = new Promise<void>((resolve) => {
      notifyLookupStarted = resolve;
    });
    const lookup: LookupFunction = (_hostname, options, callback) => {
      releaseLookup = () => {
        if ("all" in options && options.all) {
          callback(null, [{ address: "93.184.216.34", family: 4 }]);
          return;
        }
        callback(null, "93.184.216.34", 4);
      };
      notifyLookupStarted?.();
    };
    const connect = (options: NetConnectOpts): net.Socket => {
      const tcpOptions = options as TcpNetConnectOpts;
      tcpOptions.lookup?.(
        String(tcpOptions.host),
        { all: true },
        (error: NodeJS.ErrnoException | null) => {
          if (!error) {
            upstream.emit("connect");
          }
        }
      );
      return upstream;
    };
    const proxy = await startGuardedSocksProxy({ connect, lookup });
    const client = connectProxy(proxy.server);
    client.on("error", () => undefined);
    await new Promise<void>((resolve) => client.once("connect", resolve));
    await authenticate(client);
    client.write(domainRequest("delayed.test", 443));
    await lookupStarted;

    proxy.abort();
    releaseLookup?.();

    expect(destroyCalls).toBeGreaterThanOrEqual(2);
    await proxy.waitClosed(100);
  });

  it("counts active client tunnels independently from their upstream sockets", async () => {
    const target = await listen();
    const connect = (options: NetConnectOpts): net.Socket =>
      net.connect({ ...options, host: "127.0.0.1" });
    const proxy = await startGuardedSocksProxy({ connect, maxConnections: 2 });

    const first = connectProxy(proxy.server);
    await new Promise<void>((resolve) => first.once("connect", resolve));
    await authenticate(first);
    first.write(ipv4Request("93.184.216.34", target.port));
    expect((await readData(first))[1]).toBe(0);

    const second = connectProxy(proxy.server);
    await new Promise<void>((resolve) => second.once("connect", resolve));
    await authenticate(second);
    second.write(ipv4Request("93.184.216.34", target.port));
    expect((await readData(second))[1]).toBe(0);

    first.destroy();
    second.destroy();
    proxy.abort();
    target.server.close();
    await proxy.waitClosed(100);
  });

  it("aborts fragmented handshakes and closes tracked sockets synchronously", async () => {
    const proxy = await startGuardedSocksProxy();
    const client = connectProxy(proxy.server);
    await new Promise<void>((resolve) => client.once("connect", resolve));
    client.on("error", () => undefined);
    client.write(Buffer.from([5]));
    proxy.abort();
    await proxy.waitClosed(100);
    await expect(
      new Promise<void>((resolve) => {
        if (client.destroyed) {
          resolve();
        } else {
          client.once("close", () => resolve());
        }
      })
    ).resolves.toBeUndefined();
  });
});
