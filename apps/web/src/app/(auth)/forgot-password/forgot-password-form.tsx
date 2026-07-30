"use client";

import { Button } from "@drop-watch/ui/components/button";
import { Input } from "@drop-watch/ui/components/input";
import { Label } from "@drop-watch/ui/components/label";
import { useForm } from "@tanstack/react-form";
import Link from "next/link";
import { type ChangeEvent, type FormEvent, useCallback, useState } from "react";
import { toast } from "sonner";
import z from "zod";

import { authClient } from "@/lib/auth-client";

const selectSubmitState = (state: { canSubmit: boolean; isSubmitting: boolean }) => ({
  canSubmit: state.canSubmit,
  isSubmitting: state.isSubmitting,
});

/**
 * Where the link in the mail lands. Better Auth's callback checks the token,
 * then redirects here with it in the query string — or with
 * `?error=INVALID_TOKEN` when it has expired.
 */
const RESET_PATH = "/reset-password";

/**
 * Asks for a reset link.
 *
 * The confirmation never says whether the address has an account, because the
 * endpoint deliberately does not either: it answers identically, and takes the
 * same amount of time, for an address it has never seen. Echoing "no such
 * user" here would hand that back on a page anyone can reach.
 */
export default function ForgotPasswordForm() {
  const [requested, setRequested] = useState(false);

  const form = useForm({
    defaultValues: {
      email: "",
    },
    onSubmit: async ({ value }) => {
      await authClient.requestPasswordReset(
        {
          email: value.email,
          redirectTo: RESET_PATH,
        },
        {
          onError: (error) => {
            toast.error(error.error.message || error.error.statusText);
          },
          onSuccess: () => {
            setRequested(true);
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

  if (requested) {
    return (
      <div className="space-y-4">
        <p className="text-sm">
          If that address has an account here, a reset link is on its way to it. The link is
          single-use and expires in an hour.
        </p>
        <Link className="text-muted-foreground text-xs hover:underline" href="/login">
          ← Back to sign in
        </Link>
      </div>
    );
  }

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
            {isSubmitting ? "Sending..." : "Send reset link"}
          </Button>
        )}
      </form.Subscribe>

      <Link className="inline-block text-muted-foreground text-xs hover:underline" href="/login">
        ← Back to sign in
      </Link>
    </form>
  );
}
