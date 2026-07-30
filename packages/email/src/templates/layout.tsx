/**
 * The shell every template renders inside, plus the handful of styles they
 * share.
 *
 * Email is not the web: there is no stylesheet, no cascade worth relying on
 * and no guarantee that two clients agree on anything, so React Email's
 * components emit table-based HTML and every style here is inline. Keeping the
 * shell in one component is what stops five templates from drifting into five
 * slightly different-looking emails.
 *
 * The styles are exported rather than kept private so that a template can lay
 * out its own body copy without re-guessing the font stack — a template that
 * needs something genuinely different is free to inline it.
 *
 * Every `.tsx` in this package carries the two JSX pragmas below, and they are
 * load-bearing rather than decorative. `apps/worker` runs its TypeScript
 * through `tsx`, which reads *its own* `tsconfig.json` — one with no `jsx`
 * setting, since the worker has no UI of its own — and applies it to every
 * file it loads, including these. Without the pragmas esbuild falls back to
 * the classic runtime, emits `React.createElement` into a module that never
 * imports `React`, and the first alert email the worker tries to send dies
 * with `ReferenceError: React is not defined`. Declaring the runtime per file
 * makes these templates render the same whoever imports them.
 */

/** @jsxRuntime automatic */
/** @jsxImportSource react */

import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { CSSProperties, ReactNode } from "react";

/** The product's name as it appears in headings, subjects and footers. */
export const APP_NAME = "DropWatch";

const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const bodyStyle: CSSProperties = {
  backgroundColor: "#f6f7f9",
  fontFamily: FONT_STACK,
  margin: 0,
  padding: "24px 0",
};

const containerStyle: CSSProperties = {
  backgroundColor: "#ffffff",
  border: "1px solid #e5e7eb",
  borderRadius: "8px",
  margin: "0 auto",
  maxWidth: "560px",
  padding: "32px",
};

const headingStyle: CSSProperties = {
  color: "#111827",
  fontSize: "20px",
  fontWeight: 600,
  lineHeight: "28px",
  margin: "0 0 16px",
};

/** Body copy. The default `Text` styling is too small for a transactional mail. */
export const paragraphStyle: CSSProperties = {
  color: "#374151",
  fontSize: "15px",
  lineHeight: "24px",
  margin: "0 0 16px",
};

/** Secondary copy: the "if you did not ask for this" line, the footer. */
export const mutedStyle: CSSProperties = {
  color: "#6b7280",
  fontSize: "13px",
  lineHeight: "20px",
  margin: "0 0 8px",
};

/**
 * The call to action. A real `<a>` styled as a button rather than React
 * Email's `Button`, because every template that has one also prints the raw
 * URL underneath — some clients strip the link, and a verification mail whose
 * link cannot be reached is a locked account.
 */
export const buttonStyle: CSSProperties = {
  backgroundColor: "#111827",
  borderRadius: "6px",
  color: "#ffffff",
  display: "inline-block",
  fontSize: "15px",
  fontWeight: 600,
  padding: "12px 20px",
  textDecoration: "none",
};

/** An ordinary inline link inside body copy. */
export const linkStyle: CSSProperties = {
  color: "#2563eb",
  textDecoration: "underline",
  wordBreak: "break-all",
};

const ctaSectionStyle: CSSProperties = {
  margin: "0 0 16px",
};

const hrStyle: CSSProperties = {
  border: "none",
  borderTop: "1px solid #e5e7eb",
  margin: "24px 0 16px",
};

export interface CallToActionProps {
  label: string;
  url: string;
}

/**
 * The button every link-bearing mail ends on, with the raw URL printed
 * underneath it.
 *
 * The duplication is deliberate. Clients strip styling, rewrite anchors, and
 * some corporate gateways mangle them outright; a verification or reset link
 * that cannot be clicked has to be copyable, or the account is simply locked.
 */
export function CallToAction({ label, url }: CallToActionProps) {
  return (
    <>
      <Section style={ctaSectionStyle}>
        <Link href={url} style={buttonStyle}>
          {label}
        </Link>
      </Section>
      <Text style={mutedStyle}>
        Or paste this link into your browser:{" "}
        <Link href={url} style={linkStyle}>
          {url}
        </Link>
      </Text>
    </>
  );
}

export interface EmailLayoutProps {
  children: ReactNode;
  /** The `<h1>`. Repeated as the first line of the mail, not just the subject. */
  heading: string;
  /**
   * The inbox preview line. Clients that show it will otherwise scrape the
   * first words of the body, which for a mail that opens with a heading means
   * showing the heading twice.
   */
  preview: string;
}

export function EmailLayout({ children, heading, preview }: EmailLayoutProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Heading style={headingStyle}>{heading}</Heading>
          <Section>{children}</Section>
          <Hr style={hrStyle} />
          <Text style={mutedStyle}>
            Sent by {APP_NAME}, the self-hosted price watcher running on your own machine.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
