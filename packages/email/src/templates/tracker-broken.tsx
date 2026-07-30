/**
 * The "this tracker has stopped working" alarm.
 *
 * Separate from the price alert because it says the opposite thing: not "here
 * is a number you were waiting for" but "there is no number, and there has not
 * been one for a while". A silent tracker looks exactly like a product whose
 * price never moved, which is the failure mode this mail exists to break.
 *
 * It carries the two fields the payload adds for precisely this case —
 * `consecutiveFailures` and `error` — because a broken-tracker mail without
 * the error text is a mail that can only be acted on by going and looking.
 */

/** @jsxRuntime automatic — see ./layout.tsx for why every template declares it. */
/** @jsxImportSource react */

import type { NotificationPayload } from "@drop-watch/core/notify";
import { Link, Text } from "@react-email/components";
import type { CSSProperties } from "react";

import { productHost, productLabel } from "../format";
import {
  APP_NAME,
  buttonStyle,
  EmailLayout,
  linkStyle,
  mutedStyle,
  paragraphStyle,
} from "./layout";

const errorStyle: CSSProperties = {
  backgroundColor: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: "6px",
  color: "#b91c1c",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  fontSize: "13px",
  lineHeight: "20px",
  margin: "0 0 16px",
  padding: "12px",
  wordBreak: "break-word",
};

const actionStyle: CSSProperties = {
  margin: "20px 0 12px",
};

/** The subject. Names the product, because the tracker watches several. */
export function trackerBrokenSubject(payload: NotificationPayload): string {
  return `Tracker broken: ${productLabel(payload)}`;
}

export interface TrackerBrokenProps {
  payload: NotificationPayload;
  /** Absolute link to the product in the tracker, or `null` without `APP_URL`. */
  trackerUrl: string | null;
}

export function TrackerBroken({ payload, trackerUrl }: TrackerBrokenProps) {
  const label = productLabel(payload);
  const failures = payload.consecutiveFailures;

  return (
    <EmailLayout
      heading={`${APP_NAME} can no longer check ${label}`}
      preview={trackerBrokenSubject(payload)}
    >
      <Text style={paragraphStyle}>
        {failures === null
          ? "Checks for this product keep failing"
          : `The last ${failures} checks for this product failed in a row`}
        , so its price is no longer being tracked. The usual causes are a page that has moved, a
        selector that no longer matches, or a shop that has started blocking the tracker.
      </Text>
      {payload.error === null ? null : <Text style={errorStyle}>{payload.error}</Text>}
      <Text style={paragraphStyle}>
        The page it was checking is at{" "}
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
        This is sent once per product until it starts working again, not once per failed check.
      </Text>
    </EmailLayout>
  );
}
