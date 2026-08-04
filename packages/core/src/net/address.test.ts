import { describe, expect, it } from "vitest";
import { isGloballyRoutable } from "./address";

describe("isGloballyRoutable", () => {
  it("accepts ordinary public IPv4", () => {
    for (const ip of ["1.1.1.1", "8.8.8.8", "93.184.216.34", "104.16.132.229"]) {
      expect(isGloballyRoutable(ip), ip).toBe(true);
    }
  });

  it("rejects every non-routable IPv4 block", () => {
    const blocked = [
      "0.0.0.0",
      "10.0.0.1",
      "10.255.255.255",
      "100.64.0.1", // carrier-grade NAT
      "127.0.0.1",
      "127.1.2.3",
      "169.254.169.254", // the cloud metadata endpoint
      "172.16.0.1",
      "172.31.255.255",
      "192.0.0.1",
      "192.0.2.5",
      "192.88.99.1",
      "192.168.1.1",
      "198.18.0.1",
      "198.51.100.7",
      "203.0.113.9",
      "224.0.0.1",
      "239.255.255.255",
      "240.0.0.1",
      "255.255.255.255",
    ];
    for (const ip of blocked) {
      expect(isGloballyRoutable(ip), ip).toBe(false);
    }
  });

  it("keeps the boundaries of 172.16.0.0/12 straight", () => {
    expect(isGloballyRoutable("172.15.255.255")).toBe(true);
    expect(isGloballyRoutable("172.16.0.0")).toBe(false);
    expect(isGloballyRoutable("172.31.255.255")).toBe(false);
    expect(isGloballyRoutable("172.32.0.0")).toBe(true);
  });

  it("keeps the boundaries of 100.64.0.0/10 straight", () => {
    expect(isGloballyRoutable("100.63.255.255")).toBe(true);
    expect(isGloballyRoutable("100.64.0.0")).toBe(false);
    expect(isGloballyRoutable("100.127.255.255")).toBe(false);
    expect(isGloballyRoutable("100.128.0.0")).toBe(true);
  });

  it("reads an octal-looking octet as decimal, which is the safe direction", () => {
    // 010.0.0.1 is 8.0.0.1 to a C resolver and 10.0.0.1 to this one. Blocking
    // is the conservative reading of an ambiguous address.
    expect(isGloballyRoutable("010.0.0.1")).toBe(false);
  });

  it("accepts ordinary public IPv6", () => {
    for (const ip of ["2606:4700:4700::1111", "2a00:1450:4009:81f::200e"]) {
      expect(isGloballyRoutable(ip), ip).toBe(true);
    }
  });

  it("rejects every non-routable IPv6 block", () => {
    const blocked = [
      "::", // unspecified
      "::1", // loopback
      "fc00::1", // unique-local
      "fd12:3456:789a::1",
      "fe80::1", // link-local
      "febf:ffff::1",
      "ff02::1", // multicast
      "100::1", // discard-only
      "2001::1", // Teredo
      "2001:db8::1", // documentation
    ];
    for (const ip of blocked) {
      expect(isGloballyRoutable(ip), ip).toBe(false);
    }
  });

  it("matches the current IANA IPv6 special-purpose boundaries", () => {
    const blocked = [
      "64:ff9b:1::",
      "64:ff9b:1:ffff:ffff:ffff:ffff:ffff",
      "100:0:0:1::",
      "100:0:0:1:ffff:ffff:ffff:ffff",
      "3fff::",
      "3fff:0fff:ffff:ffff:ffff:ffff:ffff:ffff",
      "5f00::",
      "5f00:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    ];
    for (const ip of blocked) {
      expect(isGloballyRoutable(ip), ip).toBe(false);
    }

    const outside = ["64:ff9a:ffff::1", "100:0:0:2::1", "3fff:1000::1", "5f01::1"];
    for (const ip of outside) {
      expect(isGloballyRoutable(ip), ip).toBe(true);
    }
  });

  it("allows only the globally reachable exceptions inside 2001::/23", () => {
    const routable = [
      "2001:1::1",
      "2001:1::2",
      "2001:1::3",
      "2001:3::1",
      "2001:4:112::1",
      "2001:20::1",
      "2001:30::1",
    ];
    for (const ip of routable) {
      expect(isGloballyRoutable(ip), ip).toBe(true);
    }

    const blocked = ["2001::1", "2001:1::4", "2001:2::1", "2001:db8::1"];
    for (const ip of blocked) {
      expect(isGloballyRoutable(ip), ip).toBe(false);
    }

    expect(isGloballyRoutable("2001:200::1")).toBe(true);
  });

  it("unwraps IPv4-mapped, NAT64 and 6to4 addresses before judging them", () => {
    expect(isGloballyRoutable("::ffff:169.254.169.254")).toBe(false);
    expect(isGloballyRoutable("::ffff:127.0.0.1")).toBe(false);
    expect(isGloballyRoutable("::ffff:a9fe:a9fe")).toBe(false); // the same, in hex
    expect(isGloballyRoutable("::ffff:8.8.8.8")).toBe(true);
    expect(isGloballyRoutable("64:ff9b::10.0.0.1")).toBe(false); // NAT64
    expect(isGloballyRoutable("2002:7f00:0001::")).toBe(false); // 6to4 over 127.0.0.1
    expect(isGloballyRoutable("2002:0808:0808::")).toBe(true); // 6to4 over 8.8.8.8
  });

  it("ignores a zone id", () => {
    expect(isGloballyRoutable("fe80::1%eth0")).toBe(false);
  });

  it("refuses anything that is not an IP address at all", () => {
    for (const value of [
      "",
      "example.com",
      "1.2.3",
      "1.2.3.4.5",
      "300.1.1.1",
      "::gggg",
      "1::2::3",
    ]) {
      expect(isGloballyRoutable(value), value).toBe(false);
    }
  });
});
