"use client";

import { Button } from "@price-tracker/ui/components/button";
import { Input } from "@price-tracker/ui/components/input";
import { Label } from "@price-tracker/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { useRouter } from "next/navigation";
import { type ChangeEvent, type FormEvent, useCallback } from "react";
import { toast } from "sonner";
import z from "zod";

import { authClient } from "@/lib/auth-client";

const selectSubmitState = (state: { canSubmit: boolean; isSubmitting: boolean }) => ({
  canSubmit: state.canSubmit,
  isSubmitting: state.isSubmitting,
});

/** Better Auth's own floor, repeated here so the failure is client-side. */
const MIN_PASSWORD_LENGTH = 8;

/**
 * Sets a new password from a token in the URL.
 *
 * The token is the entire authorisation — whoever holds it proves they read
 * the inbox — so it is never rendered, only posted. Confirming the password
 * twice is not ceremony either: a typo here locks the account out of a tracker
 * whose only other way in is the mail that has just been spent.
 */
export default function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();

  const form = useForm({
    defaultValues: {
      confirmPassword: "",
      password: "",
    },
    onSubmit: async ({ value }) => {
      await authClient.resetPassword(
        {
          newPassword: value.password,
          token,
        },
        {
          onError: (error) => {
            toast.error(error.error.message || error.error.statusText);
          },
          onSuccess: () => {
            toast.success("Password updated. Sign in with the new one.");
            router.push("/login");
          },
        }
      );
    },
    validators: {
      onSubmit: z
        .object({
          confirmPassword: z.string(),
          password: z.string().min(MIN_PASSWORD_LENGTH, "Password must be at least 8 characters"),
        })
        .refine((value) => value.password === value.confirmPassword, {
          message: "Passwords do not match",
          path: ["confirmPassword"],
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
      <form.Field name="password">
        {(field) => {
          const handleChange = (e: ChangeEvent<HTMLInputElement>) =>
            field.handleChange(e.target.value);
          return (
            <div className="space-y-2">
              <Label htmlFor={field.name}>New password</Label>
              <Input
                autoComplete="new-password"
                id={field.name}
                name={field.name}
                onBlur={field.handleBlur}
                onChange={handleChange}
                type="password"
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

      <form.Field name="confirmPassword">
        {(field) => {
          const handleChange = (e: ChangeEvent<HTMLInputElement>) =>
            field.handleChange(e.target.value);
          return (
            <div className="space-y-2">
              <Label htmlFor={field.name}>Confirm new password</Label>
              <Input
                autoComplete="new-password"
                id={field.name}
                name={field.name}
                onBlur={field.handleBlur}
                onChange={handleChange}
                type="password"
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
            {isSubmitting ? "Saving..." : "Set new password"}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
