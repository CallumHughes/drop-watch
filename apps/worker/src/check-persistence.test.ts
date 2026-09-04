import type { FetchPageResult } from "@drop-watch/core/fetch";
import { describe, expect, it } from "vitest";

import {
  completePersistedCheck,
  STALE_CHECK_DISCARD_MESSAGE,
  validatorUpdate,
} from "./check-persistence";

const headers = { etag: '"next"', lastModified: "Thu, 22 Oct 2026 07:28:00 GMT" };

const fetched200: FetchPageResult = {
  body: "<html></html>",
  durationMs: 120,
  httpStatus: 200,
  status: "ok",
  url: "https://example.com/product",
  ...headers,
};

describe("validatorUpdate", () => {
  it("does not advance validators for a rejected 200 body", () => {
    expect(validatorUpdate(fetched200, false)).toEqual({});
  });

  it("keeps validators from an accepted 200 observation", () => {
    expect(validatorUpdate(fetched200, true)).toEqual(headers);
  });

  it("preserves a validator refresh supplied by a 304", () => {
    const notModified: FetchPageResult = {
      durationMs: 30,
      httpStatus: 304,
      status: "not_modified",
      ...headers,
    };
    expect(validatorUpdate(notModified, false)).toEqual(headers);
  });

  it("does not invent validators when a 304 has no headers", () => {
    const notModified: FetchPageResult = {
      durationMs: 30,
      httpStatus: 304,
      status: "not_modified",
    };
    expect(validatorUpdate(notModified, false)).toEqual({});
  });
});

describe("completePersistedCheck", () => {
  it("discards a stale check without invoking alerting", async () => {
    let discarded = false;
    let alerted = false;

    await completePersistedCheck("stale", {
      onPersisted: () => {
        alerted = true;
        return Promise.resolve();
      },
      onStale: () => {
        discarded = true;
      },
    });

    expect(discarded).toBe(true);
    expect(alerted).toBe(false);
    expect(STALE_CHECK_DISCARD_MESSAGE).toContain("no price");
  });

  it("continues to alert only after persistence succeeds", async () => {
    let alerted = false;
    await completePersistedCheck("persisted", {
      onPersisted: () => {
        alerted = true;
        return Promise.resolve();
      },
      onStale: () => {
        throw new Error("stale callback should not run");
      },
    });
    expect(alerted).toBe(true);
  });
});
