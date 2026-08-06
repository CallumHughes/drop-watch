import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Context } from "../context";

// The module reads `env` at import time, so each branch needs its own mock
// plus a fresh module graph — a single import would only ever see whichever
// value was mocked first.
const fakeContext: Context = {
  auth: null,
  session: { user: { id: "user-1", role: "user" } } as never,
};

describe("capabilities", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("reports browserRender true when RENDER_URL is configured", async () => {
    vi.doMock("@drop-watch/env/server", () => ({
      env: { RENDER_URL: "http://renderer:3002" },
    }));
    const { capabilities } = await import("./capabilities");

    expect(await call(capabilities, undefined, { context: fakeContext })).toEqual({
      browserRender: true,
    });
  });

  it("reports browserRender false when RENDER_URL is unset", async () => {
    vi.doMock("@drop-watch/env/server", () => ({ env: { RENDER_URL: undefined } }));
    const { capabilities } = await import("./capabilities");

    expect(await call(capabilities, undefined, { context: fakeContext })).toEqual({
      browserRender: false,
    });
  });
});
