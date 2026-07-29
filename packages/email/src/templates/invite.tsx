/**
 * An admin's invitation to join the tracker.
 *
 * Signup is invite-only, so this link is the recipient's only way to an
 * account — hence the raw URL {@link CallToAction} prints under the button for
 * the clients that mangle the anchor, and hence the copy naming the 48-hour
 * expiry: a stale link should read as "ask for a fresh one", not as a broken
 * tracker.
 */

/** @jsxRuntime automatic — see ./layout.tsx for why every template declares it. */
/** @jsxImportSource react */

import { Text } from "@react-email/components";

import { APP_NAME, CallToAction, EmailLayout, mutedStyle, paragraphStyle } from "./layout";

export const INVITE_SUBJECT = `You have been invited to ${APP_NAME}`;

export interface InviteProps {
  /** The invite URL, raw token included — the only place the token lives. */
  url: string;
}

export function Invite({ url }: InviteProps) {
  return (
    <EmailLayout
      heading="You're invited"
      preview={`You have been invited to create an account on ${APP_NAME}`}
    >
      <Text style={paragraphStyle}>
        You have been invited to create an account on {APP_NAME}, the self-hosted price tracker.
        Follow the link below to choose a name and password.
      </Text>
      <CallToAction label="Accept invitation" url={url} />
      <Text style={mutedStyle}>
        This link expires in 48 hours. If you were not expecting an invitation, ignore this email —
        no account was created.
      </Text>
    </EmailLayout>
  );
}
