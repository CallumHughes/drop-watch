/**
 * Password reset.
 *
 * The reason email exists on a single-user tracker at all: signup slams shut
 * after the first account, so without a reset link a forgotten password means
 * editing the database by hand. The copy says out loud that nothing has
 * changed yet, because a "reset your password" mail that arrives unrequested
 * reads like a break-in until it explains itself.
 */

/** @jsxRuntime automatic — see ./layout.tsx for why every template declares it. */
/** @jsxImportSource react */

import { Text } from "@react-email/components";

import { APP_NAME, CallToAction, EmailLayout, mutedStyle, paragraphStyle } from "./layout";

export const RESET_PASSWORD_SUBJECT = `Reset your ${APP_NAME} password`;

export interface ResetPasswordProps {
  /** Better Auth's one-time reset URL, token included. */
  url: string;
}

export function ResetPassword({ url }: ResetPasswordProps) {
  return (
    <EmailLayout
      heading="Reset your password"
      preview={`Choose a new password for your ${APP_NAME} account`}
    >
      <Text style={paragraphStyle}>
        Someone asked to reset the password on your {APP_NAME} account. Choose a new one here:
      </Text>
      <CallToAction label="Choose a new password" url={url} />
      <Text style={mutedStyle}>
        If that was not you, ignore this email. Your password has not been changed and this link
        expires on its own.
      </Text>
    </EmailLayout>
  );
}
