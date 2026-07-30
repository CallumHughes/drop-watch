import { requireEmailEnabled } from "@/lib/email-routes";

import ForgotPasswordForm from "./forgot-password-form";

/**
 * The way back into a tracker whose signup has closed.
 *
 * Signup shuts for good once the first account exists, so on a single-user box
 * a forgotten password has no self-service fix other than this one — short of
 * the SQL in the README. It only exists when a mailer does; without one the
 * route 404s, since the endpoint behind it is not registered either.
 */
export default function ForgotPasswordPage() {
  requireEmailEnabled();

  return (
    <main className="container mx-auto max-w-md overflow-y-auto px-4 py-10">
      <header className="mb-6">
        <h1 className="font-medium text-xl">Reset your password</h1>
        <p className="text-muted-foreground text-sm">
          Enter the address on the account and we will send a link to set a new password.
        </p>
      </header>

      <ForgotPasswordForm />
    </main>
  );
}
