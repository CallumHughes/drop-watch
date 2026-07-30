/**
 * The alert itself: target hit, percentage drop, restock — and the settings
 * page's test send, which deliberately goes through the same template so that
 * "send test" proves the real thing works rather than proving a second one does.
 *
 * It renders a {@link NotificationPayload} unchanged. That type is already
 * channel-agnostic and always fully populated (`null` where a field does not
 * apply), which is exactly what a template wants: no field needs a guard for
 * "was it included", only for "does it apply".
 *
 * Prices arrive as decimal strings straight from `numeric(12,2)` and are
 * formatted as strings — never parsed to a float, in an email no more than
 * anywhere else. `pctChange` is likewise passed through as the upstream
 * already rounded it.
 */

/** @jsxRuntime automatic — see ./layout.tsx for why every template declares it. */
/** @jsxImportSource react */

import type { NotificationKind, NotificationPayload } from "@drop-watch/core/notify";
import { Link, Text } from "@react-email/components";
import type { CSSProperties } from "react";

import { formatPercentChange, formatPrice, productHost, productLabel } from "../format";
import {
  APP_NAME,
  buttonStyle,
  EmailLayout,
  linkStyle,
  mutedStyle,
  paragraphStyle,
} from "./layout";

const priceStyle: CSSProperties = {
  color: "#111827",
  fontSize: "28px",
  fontWeight: 700,
  lineHeight: "36px",
  margin: "0 0 4px",
};

const detailStyle: CSSProperties = {
  color: "#374151",
  fontSize: "15px",
  lineHeight: "22px",
  margin: "0 0 4px",
};

const actionStyle: CSSProperties = {
  margin: "20px 0 12px",
};

/** What the copy needs to know, already formatted, never a float. */
interface AlertCopy {
  label: string;
  /** Already suffixed and signed, or `null` when there is no previous price. */
  pctChange: string | null;
  /** Formatted with its currency, or `null` when the check found no price. */
  price: string | null;
}

function alertCopy(payload: NotificationPayload): AlertCopy {
  return {
    label: productLabel(payload),
    pctChange: payload.pctChange === null ? null : formatPercentChange(payload.pctChange),
    price: payload.price === null ? null : formatPrice(payload.price, payload.currency),
  };
}

/**
 * Headings and subjects, one per kind of notification.
 *
 * A record keyed by {@link NotificationKind} rather than a `switch`, because
 * the record is exhaustive by construction: adding a rule to
 * `@drop-watch/core/rules` fails to compile here until someone writes the
 * words a person will read, instead of silently falling through to a generic
 * "Alert:" line. `tracker_broken` has its own template and never reaches these
 * — the entries exist only so the type is total.
 */
const HEADINGS: Record<NotificationKind, (copy: AlertCopy) => string> = {
  drop_percent: ({ label }) => `${label} has dropped in price`,
  restock: ({ label }) => `${label} is back in stock`,
  target: ({ label }) => `${label} has hit your target price`,
  test: () => `Test alert from ${APP_NAME}`,
  tracker_broken: ({ label }) => `Alert for ${label}`,
};

/**
 * Subjects are front-loaded with what happened and the new price: an alert
 * that has to be opened to find out whether it matters is an alert that gets
 * ignored.
 */
const SUBJECTS: Record<NotificationKind, (copy: AlertCopy) => string> = {
  drop_percent: ({ label, pctChange, price }) => {
    const change = pctChange === null ? "" : ` ${pctChange}`;
    return price === null
      ? `Price drop${change}: ${label}`
      : `Price drop${change}: ${label} now ${price}`;
  },
  restock: ({ label }) => `Back in stock: ${label}`,
  target: ({ label, price }) =>
    price === null ? `Target hit: ${label}` : `Target hit: ${label} at ${price}`,
  test: () => `Test alert from ${APP_NAME}`,
  tracker_broken: ({ label }) => `Alert: ${label}`,
};

/** The one-line reason this mail exists, used as both heading and preview. */
export function priceAlertHeading(payload: NotificationPayload): string {
  return HEADINGS[payload.rule](alertCopy(payload));
}

/** The subject line. */
export function priceAlertSubject(payload: NotificationPayload): string {
  return SUBJECTS[payload.rule](alertCopy(payload));
}

export interface PriceAlertProps {
  payload: NotificationPayload;
  /**
   * Absolute link to the product's page in the tracker, or `null` when
   * `APP_URL` is unset. Omitted rather than rendered relative: a dead link in
   * a mail client cannot be fixed by the reader, and the shop link below still
   * makes the mail useful.
   */
  trackerUrl: string | null;
}

export function PriceAlert({ payload, trackerUrl }: PriceAlertProps) {
  const heading = priceAlertHeading(payload);
  const price = payload.price === null ? null : formatPrice(payload.price, payload.currency);
  const previousPrice =
    payload.previousPrice === null ? null : formatPrice(payload.previousPrice, payload.currency);

  return (
    <EmailLayout heading={heading} preview={priceAlertSubject(payload)}>
      {price === null ? null : <Text style={priceStyle}>{price}</Text>}
      {previousPrice === null ? null : (
        <Text style={detailStyle}>
          Was {previousPrice}
          {payload.pctChange === null ? "" : ` (${formatPercentChange(payload.pctChange)})`}
        </Text>
      )}
      {payload.inStock === null ? null : (
        <Text style={detailStyle}>{payload.inStock ? "In stock" : "Out of stock"}</Text>
      )}
      <Text style={paragraphStyle}>
        Seen at{" "}
        <Link href={payload.url} style={linkStyle}>
          {productHost(payload.url)}
        </Link>
        .
      </Text>
      <Text style={actionStyle}>
        <Link href={trackerUrl ?? payload.url} style={buttonStyle}>
          {trackerUrl === null ? "Open the product page" : "Open in Price Tracker"}
        </Link>
      </Text>
      <Text style={mutedStyle}>
        You are getting this because this address is on the {APP_NAME} account. Alerts repeat only
        after the cooldown, or when the price falls further.
      </Text>
    </EmailLayout>
  );
}
