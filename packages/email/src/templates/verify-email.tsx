/**
 * Sign-up verification.
 *
 * This is the mail an account is waiting behind: with a mailer configured,
 * `requireEmailVerification` is on, so until this link is clicked the account
 * cannot sign in. Signup also closes after the first user, which makes a lost
 * verification mail a locked box rather than an inconvenience — hence the copy
 * saying so plainly, and hence the raw URL {@link CallToAction} prints under
 * the button for the clients that mangle the anchor.
 */

/** @jsxRuntime automatic — see ./layout.tsx for why every template declares it. */
/** @jsxImportSource react */

import { Text } from "@react-email/components";

import { APP_NAME, CallToAction, EmailLayout, mutedStyle, paragraphStyle } from "./layout";

export const VERIFY_EMAIL_SUBJECT = `Verify your ${APP_NAME} email address`;

export interface VerifyEmailProps {
  /** Better Auth's one-time verification URL, token included. */
  url: string;
}

export function VerifyEmail({ url }: VerifyEmailProps) {
  return (
    <EmailLayout
      heading="Confirm your email address"
      preview={`Confirm your email address to finish setting up ${APP_NAME}`}
    >
      <Text style={paragraphStyle}>
        Confirm this address to finish setting up your {APP_NAME} account. You will not be able to
        sign in until you do.
      </Text>
      <CallToAction label="Verify email address" url={url} />
      <Text style={mutedStyle}>
        If you did not create this account, ignore this email — nothing was activated.
      </Text>
    </EmailLayout>
  );
}
