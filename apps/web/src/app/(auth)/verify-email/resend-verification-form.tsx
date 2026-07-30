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

/** Where the link drops the user once the address is confirmed. */
const AFTER_VERIFICATION = "/";

/**
 * Sends the verification mail again.
 *
 * The address has to be typed rather than read from the session because there
 * is no session: `requireEmailVerification` is exactly what stops one being
 * created, so an unverified account arrives here signed out. That is also why
 * this cannot be a bare button.
 */
export default function ResendVerificationForm({ defaultEmail }: { defaultEmail?: string }) {
  const form = useForm({
    defaultValues: {
      email: defaultEmail ?? "",
    },
    onSubmit: async ({ value }) => {
      await authClient.sendVerificationEmail(
        {
          callbackURL: AFTER_VERIFICATION,
          email: value.email,
        },
        {
          onError: (error) => {
            toast.error(error.error.message || error.error.statusText);
          },
          onSuccess: () => {
            toast.success("Verification email sent.");
          },
        }
      );
    },
    validators: {
      onSubmit: z.object({
        email: z.email("Invalid email address"),
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
      <form.Field name="email">
        {(field) => {
          const handleChange = (e: ChangeEvent<HTMLInputElement>) =>
            field.handleChange(e.target.value);
          return (
            <div className="space-y-2">
              <Label htmlFor={field.name}>Email</Label>
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

      <form.Subscribe selector={selectSubmitState}>
        {({ canSubmit, isSubmitting }) => (
          <Button className="w-full" disabled={!canSubmit || isSubmitting} type="submit">
            {isSubmitting ? "Sending..." : "Resend verification email"}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
