/**
 * Which IP addresses this app is willing to talk to.
 *
 * The rule is IANA's "globally reachable" column, which is wider than RFC1918:
 * the address that matters most here is `169.254.169.254`, the cloud metadata
 * endpoint, and that one is link-local rather than private.
 *
 * Classifies a string; it does not resolve names. `./guard` owns the policy.
 */

// biome-ignore-all lint/suspicious/noBitwiseOperators: prefix masking is what this file does.

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV4_OCTETS = 4;
const IPV6_GROUPS = 8;
const MAX_OCTET = 255;
const MAX_GROUP = 0xff_ff;
const HEX = 16;
const IPV6_GROUP_PATTERN = /^[0-9a-f]{1,4}$/i;

interface Prefix {
  /** Network address as an unsigned 32-bit integer. */
  base: number;
  bits: number;
}

/**
 * IPv4 special-purpose blocks that are not globally reachable
 * (RFC 6890 and the IANA IPv4 Special-Purpose Address Registry).
 */
const IPV4_BLOCKED: readonly Prefix[] = [
  { base: ipv4ToInt([0, 0, 0, 0]), bits: 8 }, // "this network"
  { base: ipv4ToInt([10, 0, 0, 0]), bits: 8 }, // private
  { base: ipv4ToInt([100, 64, 0, 0]), bits: 10 }, // carrier-grade NAT
  { base: ipv4ToInt([127, 0, 0, 0]), bits: 8 }, // loopback
  { base: ipv4ToInt([169, 254, 0, 0]), bits: 16 }, // link-local — cloud metadata lives here
  { base: ipv4ToInt([172, 16, 0, 0]), bits: 12 }, // private
  { base: ipv4ToInt([192, 0, 0, 0]), bits: 24 }, // IETF protocol assignments
  { base: ipv4ToInt([192, 0, 2, 0]), bits: 24 }, // TEST-NET-1
  { base: ipv4ToInt([192, 88, 99, 0]), bits: 24 }, // deprecated 6to4 relay anycast
  { base: ipv4ToInt([192, 168, 0, 0]), bits: 16 }, // private
  { base: ipv4ToInt([198, 18, 0, 0]), bits: 15 }, // benchmarking
  { base: ipv4ToInt([198, 51, 100, 0]), bits: 24 }, // TEST-NET-2
  { base: ipv4ToInt([203, 0, 113, 0]), bits: 24 }, // TEST-NET-3
  { base: ipv4ToInt([224, 0, 0, 0]), bits: 4 }, // multicast
  { base: ipv4ToInt([240, 0, 0, 0]), bits: 4 }, // reserved, and 255.255.255.255 with it
];

function ipv4ToInt(octets: readonly number[]): number {
  return (
    ((octets[0] ?? 0) * 2 ** 24 +
      (octets[1] ?? 0) * 2 ** 16 +
      (octets[2] ?? 0) * 2 ** 8 +
      (octets[3] ?? 0)) >>>
    0
  );
}

/**
 * Dotted quad to octets, or `null` when it is not one. `Number` reads `010` as
 * 10 rather than 8, which blocks an octal-looking address rather than passing it.
 */
function parseIpv4(value: string): number[] | null {
  const match = IPV4_PATTERN.exec(value);
  if (!match) {
    return null;
  }
  const octets = match.slice(1, 1 + IPV4_OCTETS).map(Number);
  return octets.every((octet) => octet >= 0 && octet <= MAX_OCTET) ? octets : null;
}

/**
 * IPv6 text to eight 16-bit groups, or `null` when it will not parse. Handles
 * `::`, a trailing dotted-quad (`::ffff:127.0.0.1`) and a `%eth0` zone id.
 */
function parseIpv6(value: string): number[] | null {
  const address = value.split("%")[0] ?? "";
  if (address.length === 0) {
    return null;
  }

  const halves = address.split("::");
  if (halves.length > 2) {
    return null;
  }

  const expand = (part: string): number[] | null => {
    if (part.length === 0) {
      return [];
    }
    const groups: number[] = [];
    const pieces = part.split(":");
    for (const [index, piece] of pieces.entries()) {
      // Only the final piece may be a dotted quad, and it fills two groups.
      if (index === pieces.length - 1 && piece.includes(".")) {
        const octets = parseIpv4(piece);
        if (!octets) {
          return null;
        }
        groups.push(
          ((octets[0] ?? 0) << 8) | (octets[1] ?? 0),
          ((octets[2] ?? 0) << 8) | (octets[3] ?? 0)
        );
        continue;
      }
      if (!IPV6_GROUP_PATTERN.test(piece)) {
        return null;
      }
      groups.push(Number.parseInt(piece, HEX));
    }
    return groups;
  };

  const head = expand(halves[0] ?? "");
  if (!head) {
    return null;
  }
  if (halves.length === 1) {
    return head.length === IPV6_GROUPS ? head : null;
  }

  const tail = expand(halves[1] ?? "");
  if (!tail) {
    return null;
  }
  const missing = IPV6_GROUPS - head.length - tail.length;
  // `::` must stand for at least one group.
  if (missing < 1) {
    return null;
  }
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

function withinPrefix(value: number, prefix: Prefix): boolean {
  if (prefix.bits === 0) {
    return true;
  }
  const mask = (0xff_ff_ff_ff << (32 - prefix.bits)) >>> 0;
  return (value & mask) >>> 0 === prefix.base;
}

function isIpv4Routable(octets: readonly number[]): boolean {
  const value = ipv4ToInt(octets);
  return !IPV4_BLOCKED.some((prefix) => withinPrefix(value, prefix));
}

function groupsMatch(groups: readonly number[], prefix: readonly number[]): boolean {
  return prefix.every((expected, index) => groups[index] === expected);
}

/**
 * An embedded IPv4 address, if there is one. `::ffff:169.254.169.254` reaches
 * the metadata service exactly as the bare v4 form does, so it is judged as v4.
 */
function embeddedIpv4(groups: readonly number[]): number[] | null {
  // ::ffff:0:0/96 (IPv4-mapped) and 64:ff9b::/96 (NAT64).
  const mapped = groupsMatch(groups, [0, 0, 0, 0, 0, MAX_GROUP]);
  const nat64 = groupsMatch(groups, [0x00_64, 0xff_9b, 0, 0, 0, 0]);
  if (mapped || nat64) {
    return toOctets(groups[6] ?? 0, groups[7] ?? 0);
  }
  // 2002::/16 (6to4) carries the v4 address in the next 32 bits.
  if (groups[0] === 0x20_02) {
    return toOctets(groups[1] ?? 0, groups[2] ?? 0);
  }
  return null;
}

function toOctets(high: number, low: number): number[] {
  return [high >> 8, high & MAX_OCTET, low >> 8, low & MAX_OCTET];
}

function isIpv6Routable(groups: readonly number[]): boolean {
  const embedded = embeddedIpv4(groups);
  if (embedded) {
    return isIpv4Routable(embedded);
  }
  // ::/128 unspecified and ::1/128 loopback.
  if (groups.slice(0, 7).every((group) => group === 0) && (groups[7] ?? 0) <= 1) {
    return false;
  }
  const first = groups[0] ?? 0;
  const second = groups[1] ?? 0;
  const blocked =
    // 100::/64 discard-only.
    groupsMatch(groups, [0x01_00, 0, 0, 0]) ||
    // 2001::/23 IETF protocol assignments — Teredo (2001::/32) among them.
    (first === 0x20_01 && (second & 0xfe_00) === 0) ||
    // 2001:db8::/32 documentation.
    (first === 0x20_01 && second === 0x0d_b8) ||
    // fc00::/7 unique-local.
    (first & 0xfe_00) === 0xfc_00 ||
    // fe80::/10 link-local.
    (first & 0xff_c0) === 0xfe_80 ||
    // ff00::/8 multicast.
    (first & 0xff_00) === 0xff_00;
  return !blocked;
}

/**
 * Whether `ip` is an address we are willing to connect to. Anything that will
 * not parse is refused — the input is always a resolved address, so a value
 * that is not one means something unexpected happened.
 */
export function isGloballyRoutable(ip: string): boolean {
  const octets = parseIpv4(ip);
  if (octets) {
    return isIpv4Routable(octets);
  }
  const groups = parseIpv6(ip);
  if (groups) {
    return isIpv6Routable(groups);
  }
  return false;
}
