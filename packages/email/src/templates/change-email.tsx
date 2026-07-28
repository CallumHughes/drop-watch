/**
 * Approval for changing the address on an account.
 *
 * Better Auth 1.6.23 hands this callback `{ user, newEmail, url, token }` from
 * `user.changeEmail.sendChangeEmailConfirmation`, where `user` is the account
 * as it stands *now* — so this mail goes to the address currently on file, not
 * to the one being moved to. That is the security property worth having: only
 * whoever already reads the current inbox can hand the account to a new one,
 * and it is why the copy addresses the reader as the existing owner and names
 * `newEmail` as a destination rather than as "your address".
 *
 * The template takes the new address explicitly instead of digging it out of a
 * URL, because the whole point of the mail is that the reader can see where
 * their account is about to go without clicking anything.
 */

/** @jsxRuntime automatic — see ./layout.tsx for why every template declares it. */
/** @jsxImportSource react */

import { Text } from "@react-email/components";

import { APP_NAME, CallToAction, EmailLayout, mutedStyle, paragraphStyle } from "./layout";

export const CHANGE_EMAIL_SUBJECT = `Confirm the new email address on your ${APP_NAME} account`;

export interface ChangeEmailProps {
  /** The address the account would move to. Shown, never linked. */
  newEmail: string;
  /** Better Auth's one-time approval URL, token included. */
  url: string;
}

export function ChangeEmail({ newEmail, url }: ChangeEmailProps) {
  return (
    <EmailLayout
      heading="Confirm your new email address"
      preview={`Approve moving your ${APP_NAME} account to ${newEmail}`}
    >
      <Text style={paragraphStyle}>
        Someone asked to change the email address on your {APP_NAME} account to{" "}
        <strong>{newEmail}</strong>. Approving this moves sign-in, password resets and alert emails
        to that address.
      </Text>
      <CallToAction label="Confirm the change" url={url} />
      <Text style={mutedStyle}>
        If you did not ask for this, ignore this email. Your address stays as it is, and whoever
        asked cannot proceed without this link.
      </Text>
    </EmailLayout>
  );
}
