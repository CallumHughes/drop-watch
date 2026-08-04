import type { LookupFunction, NetConnectOpts } from "node:net";
import net from "node:net";
import { BlockedAddressError, checkLiteralHost, guardedLookup } from "@drop-watch/core/net/guard";

const SOCKS_VERSION = 5;
const NO_AUTHENTICATION = 0;
const NO_ACCEPTABLE_AUTHENTICATION = 0xff;
const CONNECT_COMMAND = 1;
const ADDRESS_NOT_SUPPORTED = 8;
const COMMAND_NOT_SUPPORTED = 7;
const CONNECTION_NOT_ALLOWED = 2;
const CONNECTION_REFUSED = 5;
const IPV4_ADDRESS_TYPE = 1;
const DOMAIN_ADDRESS_TYPE = 3;
const IPV6_ADDRESS_TYPE = 4;
const MAX_HANDSHAKE_BYTES = 1024;
const MAX_HOSTNAME_BYTES = 253;
const HANDSHAKE_TIMEOUT_MS = 3000;
const UPSTREAM_CONNECT_TIMEOUT_MS = 5000;
const MAX_CONNECTIONS = 64;

type Connect = (options: NetConnectOpts) => net.Socket;

export interface GuardedSocksProxyOptions {
  connect?: Connect;
  handshakeTimeoutMs?: number;
  lookup?: LookupFunction;
  maxConnections?: number;
  upstreamConnectTimeoutMs?: number;
}

export interface GuardedSocksProxy {
  abort: () => void;
  refusal: () => string | null;
  readonly server: string;
  waitClosed: (timeoutMs: number) => Promise<void>;
}

interface Reader {
  close: () => void;
  read: (length: number) => Promise<Buffer>;
  remaining: () => Buffer;
}

interface SocksTarget {
  hostname: string;
  literal: boolean;
  port: number;
}

class SocksProtocolError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface ClientOptions {
  connect: Connect;
  handshakeTimeoutMs: number;
  isAborted: () => boolean;
  lookup: LookupFunction;
  setRefusal: (reason: string) => void;
  upstreamConnectTimeoutMs: number;
  upstreamSockets: Set<net.Socket>;
}

function createReader(socket: net.Socket, timeoutMs: number): Reader {
  let buffered = Buffer.alloc(0);
  let pending: {
    length: number;
    resolve: (value: Buffer) => void;
    reject: (reason: Error) => void;
    timer: NodeJS.Timeout;
  } | null = null;

  const rejectPending = (error: Error): void => {
    const current = pending;
    pending = null;
    if (current) {
      clearTimeout(current.timer);
      current.reject(error);
    }
  };

  const consume = (): void => {
    if (!pending || buffered.length < pending.length) {
      return;
    }
    const current = pending;
    pending = null;
    clearTimeout(current.timer);
    const value = buffered.subarray(0, current.length);
    buffered = buffered.subarray(current.length);
    current.resolve(value);
  };

  const onData = (chunk: Buffer): void => {
    buffered = Buffer.concat([buffered, chunk]);
    if (buffered.length > MAX_HANDSHAKE_BYTES) {
      rejectPending(new Error("SOCKS handshake is too large"));
      socket.destroy();
      return;
    }
    consume();
  };
  const onError = (error: Error): void => rejectPending(error);
  const onEnd = (): void => rejectPending(new Error("SOCKS client closed during handshake"));

  socket.on("data", onData);
  socket.on("error", onError);
  socket.on("end", onEnd);

  return {
    close(): void {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("end", onEnd);
      rejectPending(new Error("SOCKS reader closed"));
    },
    read(length: number): Promise<Buffer> {
      if (length < 1 || length > MAX_HANDSHAKE_BYTES) {
        return Promise.reject(new Error("invalid SOCKS read length"));
      }
      if (pending) {
        return Promise.reject(new Error("concurrent SOCKS reads"));
      }
      if (buffered.length >= length) {
        const value = buffered.subarray(0, length);
        buffered = buffered.subarray(length);
        return Promise.resolve(value);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending = null;
          reject(new Error("SOCKS handshake timed out"));
          socket.destroy();
        }, timeoutMs);
        pending = { length, reject, resolve, timer };
        consume();
      });
    },
    remaining(): Buffer {
      return buffered;
    },
  };
}

function reply(status: number, port = 0): Buffer {
  const address = Buffer.alloc(10);
  address[0] = SOCKS_VERSION;
  address[1] = status;
  address[2] = 0;
  address[3] = IPV4_ADDRESS_TYPE;
  address.writeUInt16BE(port, 8);
  return address;
}

async function readTarget(reader: Reader): Promise<SocksTarget> {
  const header = await reader.read(4);
  if (header[0] !== SOCKS_VERSION || header[2] !== 0) {
    throw new Error("malformed SOCKS request");
  }
  if (header[1] !== CONNECT_COMMAND) {
    throw new SocksProtocolError("SOCKS command is not CONNECT", COMMAND_NOT_SUPPORTED);
  }

  let hostname: string;
  if (header[3] === IPV4_ADDRESS_TYPE) {
    const address = await reader.read(4);
    hostname = [...address].join(".");
  } else if (header[3] === IPV6_ADDRESS_TYPE) {
    const address = await reader.read(16);
    const groups: string[] = [];
    for (let index = 0; index < 16; index += 2) {
      groups.push(address.readUInt16BE(index).toString(16));
    }
    hostname = groups.join(":");
  } else if (header[3] === DOMAIN_ADDRESS_TYPE) {
    const length = (await reader.read(1))[0] ?? 0;
    if (length < 1 || length > MAX_HOSTNAME_BYTES) {
      throw new SocksProtocolError("SOCKS hostname is too long", ADDRESS_NOT_SUPPORTED);
    }
    hostname = (await reader.read(length)).toString("utf8");
    if (hostname.includes("\u0000")) {
      throw new SocksProtocolError("SOCKS hostname contains a NUL", ADDRESS_NOT_SUPPORTED);
    }
  } else {
    throw new SocksProtocolError("SOCKS address type is unsupported", ADDRESS_NOT_SUPPORTED);
  }

  const port = (await reader.read(2)).readUInt16BE(0);
  if (port === 0) {
    throw new SocksProtocolError("SOCKS port is zero", ADDRESS_NOT_SUPPORTED);
  }
  return { hostname, literal: net.isIP(hostname) !== 0, port };
}

function connectUpstream(
  connect: Connect,
  target: SocksTarget,
  lookup: LookupFunction,
  timeoutMs: number,
  upstreamSockets: Set<net.Socket>,
  isAborted: () => boolean
): Promise<net.Socket> {
  if (isAborted()) {
    return Promise.reject(new Error("SOCKS proxy was aborted"));
  }
  const options: NetConnectOpts = {
    host: target.hostname,
    lookup: target.literal ? undefined : lookup,
    port: target.port,
    ...(target.literal ? {} : { autoSelectFamily: true }),
  };
  let upstream: net.Socket;
  try {
    upstream = connect(options);
  } catch (error) {
    return Promise.reject(error);
  }
  if (isAborted()) {
    upstream.destroy();
    return Promise.reject(new Error("SOCKS proxy was aborted"));
  }

  upstreamSockets.add(upstream);
  upstream.once("close", () => upstreamSockets.delete(upstream));
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(
      () => upstream.destroy(new Error("upstream connection timed out")),
      timeoutMs
    );
    const cleanup = (): void => {
      clearTimeout(timer);
      upstream.off("connect", onConnect);
      upstream.off("error", onError);
      upstream.off("close", onCloseBeforeConnect);
    };
    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      upstreamSockets.delete(upstream);
      reject(error);
    };
    const onConnect = (): void => {
      if (isAborted()) {
        fail(new Error("SOCKS proxy was aborted"));
        upstream.destroy();
        return;
      }
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(upstream);
    };
    const onError = (error: Error): void => {
      fail(error);
    };
    const onCloseBeforeConnect = (): void => {
      fail(new Error("upstream closed before connecting"));
    };
    upstream.once("connect", onConnect);
    upstream.once("error", onError);
    upstream.once("close", onCloseBeforeConnect);
  });
}

async function negotiate(client: net.Socket, reader: Reader): Promise<void> {
  const greeting = await reader.read(2);
  if (greeting[0] !== SOCKS_VERSION) {
    throw new Error("SOCKS version is unsupported");
  }
  const methodCount = greeting[1] ?? 0;
  if (methodCount < 1 || methodCount > 32) {
    throw new Error("SOCKS authentication method count is invalid");
  }
  const methods = await reader.read(methodCount);
  if (!methods.includes(NO_AUTHENTICATION)) {
    client.write(Buffer.from([SOCKS_VERSION, NO_ACCEPTABLE_AUTHENTICATION]));
    throw new Error("SOCKS authentication is unsupported");
  }
  client.write(Buffer.from([SOCKS_VERSION, NO_AUTHENTICATION]));
}

function statusForError(error: unknown): number {
  if (error instanceof SocksProtocolError) {
    return error.status;
  }
  if (error instanceof BlockedAddressError) {
    return CONNECTION_NOT_ALLOWED;
  }
  return CONNECTION_REFUSED;
}

function bridge(client: net.Socket, upstream: net.Socket, earlyData: Buffer): void {
  if (earlyData.length > 0) {
    upstream.write(earlyData);
  }
  client.pipe(upstream);
  upstream.pipe(client);
  const destroyBoth = (): void => {
    client.destroy();
    upstream.destroy();
  };
  client.once("error", destroyBoth);
  upstream.once("error", destroyBoth);
}

async function handleClient(client: net.Socket, options: ClientOptions): Promise<void> {
  const reader = createReader(client, options.handshakeTimeoutMs);
  let requestPhase = false;
  try {
    await negotiate(client, reader);
    requestPhase = true;
    const target = await readTarget(reader);
    if (target.literal) {
      const verdict = checkLiteralHost(target.hostname);
      if (!verdict.ok) {
        options.setRefusal(verdict.reason);
        client.write(reply(CONNECTION_NOT_ALLOWED));
        reader.close();
        client.end();
        return;
      }
    }

    const upstream = await connectUpstream(
      options.connect,
      target,
      options.lookup,
      options.upstreamConnectTimeoutMs,
      options.upstreamSockets,
      options.isAborted
    );
    const earlyData = reader.remaining();
    reader.close();
    client.write(reply(0));
    bridge(client, upstream, earlyData);
  } catch (error) {
    reader.close();
    if (error instanceof BlockedAddressError) {
      options.setRefusal(error.message);
    }
    if (requestPhase && !client.destroyed) {
      client.write(reply(statusForError(error)));
    }
    if (!client.destroyed) {
      client.end();
    }
  }
}

export async function startGuardedSocksProxy(
  options: GuardedSocksProxyOptions = {}
): Promise<GuardedSocksProxy> {
  const connect = options.connect ?? ((connectOptions) => net.connect(connectOptions));
  const lookup = options.lookup ?? guardedLookup;
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
  const upstreamConnectTimeoutMs = options.upstreamConnectTimeoutMs ?? UPSTREAM_CONNECT_TIMEOUT_MS;
  const maxConnections = options.maxConnections ?? MAX_CONNECTIONS;
  const clientSockets = new Set<net.Socket>();
  const upstreamSockets = new Set<net.Socket>();
  let firstRefusal: string | null = null;
  let aborted = false;

  const server = net.createServer((client) => {
    // The protocol reader owns a temporary error listener during the
    // handshake, but denied clients can reset after that reader is closed.
    // Keep this sink until the socket itself closes. Bridge error listeners
    // are additive, so established tunnels still tear down both sides.
    const onClientError = (): void => undefined;
    const removeClient = (): void => {
      clientSockets.delete(client);
      client.off("error", onClientError);
    };
    client.on("error", onClientError);
    client.once("close", removeClient);

    if (aborted || clientSockets.size >= maxConnections) {
      client.destroy();
      return;
    }
    clientSockets.add(client);
    client.setNoDelay(true);
    handleClient(client, {
      connect,
      handshakeTimeoutMs,
      isAborted: () => aborted,
      lookup,
      setRefusal: (reason) => {
        firstRefusal ??= reason;
      },
      upstreamConnectTimeoutMs,
      upstreamSockets,
    }).catch(() => {
      client.destroy();
    });
  });

  const closed = new Promise<void>((resolve) => {
    server.once("close", resolve);
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ host: "127.0.0.1", port: 0 });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("SOCKS proxy did not bind to an ephemeral TCP port");
  }

  return {
    abort: (): void => {
      if (aborted) {
        return;
      }
      aborted = true;
      for (const socket of clientSockets) {
        socket.destroy();
      }
      for (const socket of upstreamSockets) {
        socket.destroy();
      }
      clientSockets.clear();
      upstreamSockets.clear();
      try {
        server.close();
      } catch {
        // The listener may already have closed between a render and cleanup.
      }
    },
    refusal: () => firstRefusal,
    server: `socks5://127.0.0.1:${address.port}`,
    waitClosed: async (timeoutMs: number): Promise<void> => {
      await Promise.race([closed, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
    },
  };
}
