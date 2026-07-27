import { describe, expect, it } from "vitest";

import { hostnameKey } from "./index";

describe("hostnameKey", () => {
  it("lowercases the hostname", () => {
    expect(hostnameKey("https://Shop.Example.COM/item/1")).toBe("shop.example.com");
  });

  it("strips a leading www", () => {
    expect(hostnameKey("https://www.example.com/item/1")).toBe("example.com");
  });

  it("keeps www elsewhere in the hostname", () => {
    expect(hostnameKey("https://www2.example.com/item")).toBe("www2.example.com");
  });

  it("ignores port, path, and query", () => {
    expect(hostnameKey("http://example.com:8080/a/b?c=d")).toBe("example.com");
  });

  it("throws on an invalid URL", () => {
    expect(() => hostnameKey("not a url")).toThrow();
  });
});
