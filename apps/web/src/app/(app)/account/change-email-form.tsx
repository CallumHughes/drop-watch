"use client";

import { Button } from "@price-tracker/ui/components/button";
import { Input } from "@price-tracker/ui/components/input";
import { Label } from "@price-tracker/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { type ChangeEvent, type FormEvent, useCallback } from "react";
import { toast } from "sonner";
import z from "zod";

import { authClient } from "@/lib/auth-client";

const selectSubmitState = (state: { canSubmit: boolean; isSubmitting: boolean }) => ({
  canSubmit: state.canSubmit,
  isSubmitting: state.isSubmitting,
});

/** Back here once the link in the mail has been opened. */
const AFTER_CHANGE = "/account";

/**
 * Moves the account to another address.
 *
 * Nothing changes when this form is submitted; a mail does. Which inbox it
 * lands in depends on the state of the current address, and the copy has to
 * say which, or the user watches the wrong one:
 *
 * - **verified** — the approval goes to the *current* address. Only whoever
 *   already reads it may hand the account somewhere else, which is the whole
 *   point of the confirmation.
 * - **unverified** — there is nothing to confirm against, so Better Auth sends
 *   an ordinary verification to the *new* address instead, and the change
 *   lands when that link is opened.
 *
 * Both were read off `better-auth` 1.6.23's `/change-email` route rather than
 * assumed.
 */
export default function ChangeEmailForm({
  currentEmail,
  verified,
}: {
  currentEmail: string;
  verified: boolean;
}) {
  const form = useForm({
    defaultValues: {
      newEmail: "",
    },
    onSubmit: async ({ value }) => {
      await authClient.changeEmail(
        {
          callbackURL: AFTER_CHANGE,
          newEmail: value.newEmail,
        },
        {
          onError: (error) => {
            toast.error(error.error.message || error.error.statusText);
          },
          onSuccess: () => {
            toast.success(
              verified
                ? `Approval sent to ${currentEmail}. The address changes when you open it.`
                : `Verification sent to ${value.newEmail}. The address changes when you open it.`
            );
            form.reset();
          },
        }
      );
    },
    validators: {
      onSubmit: z.object({
        newEmail: z.email("Invalid email address"),
      }),
    },
  });

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      e.stopPropagation();
      form.handleSubmit();
    },
    [form]
  );

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <form.Field name="newEmail">
        {(field) => {
          const handleChange = (e: ChangeEvent<HTMLInputElement>) =>
            field.handleChange(e.target.value);
          return (
            <div className="space-y-2">
              <Label htmlFor={field.name}>New email</Label>
              <Input
                autoComplete="email"
                id={field.name}
                name={field.name}
                onBlur={field.handleBlur}
                onChange={handleChange}
                type="email"
                value={field.state.value}
              />
              {field.state.meta.errors.map((error) => (
                <p className="text-red-500" key={error?.message}>
                  {error?.message}
                </p>
              ))}
            </div>
          );
        }}
      </form.Field>

      <p className="text-muted-foreground text-xs">
        {verified
          ? `We will email ${currentEmail} to confirm. The address only changes once that link is opened.`
          : "We will email the new address to confirm. The address only changes once that link is opened."}
      </p>

      <form.Subscribe selector={selectSubmitState}>
        {({ canSubmit, isSubmitting }) => (
          <Button disabled={!canSubmit || isSubmitting} type="submit">
            {isSubmitting ? "Sending..." : "Change email"}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
