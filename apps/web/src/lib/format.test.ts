import { describe, expect, it } from "vitest";

import { formatDuration, formatPrice, formatRelative, formatStock } from "./format";

/** Intl inserts a narrow no-break space in some locales; normalise for comparison. */
function plain(value: string): string {
  return value.replace(/ | /g, " ");
}

const NOW = new Date("2026-07-27T12:00:00.000Z").getTime();

function offset(ms: number): Date {
  return new Date(NOW + ms);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatPrice", () => {
  it("formats a decimal string exactly, without going through a float", () => {
    expect(plain(formatPrice("63.00", "GBP"))).toBe("£63.00");
    expect(plain(formatPrice("1234.56", "GBP"))).toBe("£1,234.56");
  });

  it("keeps precision a float would lose", () => {
    expect(plain(formatPrice("9999999999.99", "GBP"))).toBe("£9,999,999,999.99");
  });

  it("falls back to the raw value when the currency is not yet known", () => {
    expect(formatPrice("63.00", null)).toBe("63.00");
  });
});

describe("formatRelative", () => {
  it("uses minutes within the hour, on both sides of now", () => {
    expect(formatRelative(offset(-3 * MINUTE), NOW)).toBe("3 minutes ago");
    expect(formatRelative(offset(20 * MINUTE), NOW)).toBe("in 20 minutes");
  });

  it("switches to hours past the hour boundary", () => {
    expect(formatRelative(offset(-2 * HOUR), NOW)).toBe("2 hours ago");
  });

  it("switches to days past the day boundary", () => {
    expect(formatRelative(offset(-3 * DAY), NOW)).toBe("3 days ago");
  });
});

describe("formatDuration", () => {
  it("uses milliseconds below a second and seconds above", () => {
    expect(formatDuration(545)).toBe("545ms");
    expect(formatDuration(1500)).toBe("1.5s");
  });

  it("renders a dash when no duration was recorded", () => {
    expect(formatDuration(null)).toBe("—");
  });
});

describe("formatStock", () => {
  it("distinguishes out of stock from never stated", () => {
    expect(formatStock(true)).toBe("In stock");
    expect(formatStock(false)).toBe("Out of stock");
    expect(formatStock(null)).toBe("Stock unknown");
  });
});
