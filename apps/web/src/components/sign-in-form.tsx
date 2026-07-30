import { env } from "@drop-watch/env/web";
import { Button } from "@drop-watch/ui/components/button";
import { Card, CardContent, CardHeader } from "@drop-watch/ui/components/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@drop-watch/ui/components/field";
import { Input } from "@drop-watch/ui/components/input";
import { useForm } from "@tanstack/react-form";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ChangeEvent, type FormEvent, useCallback } from "react";
import { toast } from "sonner";
import z from "zod";

import { authClient } from "@/lib/auth-client";

import Loader from "./loader";

const selectSubmitState = (state: { canSubmit: boolean; isSubmitting: boolean }) => ({
  canSubmit: state.canSubmit,
  isSubmitting: state.isSubmitting,
});

/**
 * @param onSwitchToSignUp - omitted once an account exists, after which new
 *   accounts arrive by invite rather than self-service signup.
 */
export default function SignInForm({ onSwitchToSignUp }: { onSwitchToSignUp?: () => void }) {
  const router = useRouter();
  const { isPending } = authClient.useSession();

  const form = useForm({
    defaultValues: {
      email: "",
      password: "",
    },
    onSubmit: async ({ value }) => {
      await authClient.signIn.email(
        {
          email: value.email,
          password: value.password,
        },
        {
          onError: (error) => {
            toast.error(error.error.message || error.error.statusText);
          },
          onSuccess: () => {
            router.push("/");
            toast.success("Sign in successful");
          },
        }
      );
    },
    validators: {
      onSubmit: z.object({
        email: z.email("Invalid email address"),
        password: z.string().min(8, "Password must be at least 8 characters"),
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

  if (isPending) {
    return <Loader />;
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <h1 className="cn-font-heading font-medium text-xl">Welcome Back</h1>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <form.Field name="email">
              {(field) => {
                const handleChange = (e: ChangeEvent<HTMLInputElement>) =>
                  field.handleChange(e.target.value);
                return (
                  <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
                    <FieldLabel htmlFor={field.name}>Email</FieldLabel>
                    <Input
                      id={field.name}
                      name={field.name}
                      onBlur={field.handleBlur}
                      onChange={handleChange}
                      type="email"
                      value={field.state.value}
                    />
                    <FieldError errors={field.state.meta.errors} />
                  </Field>
                );
              }}
            </form.Field>

            <form.Field name="password">
              {(field) => {
                const handleChange = (e: ChangeEvent<HTMLInputElement>) =>
                  field.handleChange(e.target.value);
                return (
                  <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
                    <div className="flex items-center">
                      <FieldLabel htmlFor={field.name}>Password</FieldLabel>
                      {/*
                       * Offered only when a mailer is configured, because
                       * without one the endpoint behind it is not registered
                       * and the page 404s. A dead "forgot password?" link is
                       * worse than no link — especially here, where it is the
                       * only route back into a box whose signup has closed.
                       */}
                      {env.NEXT_PUBLIC_EMAIL_ENABLED ? (
                        <Link
                          className="ml-auto text-sm underline-offset-4 hover:underline"
                          href="/forgot-password"
                        >
                          Forgot password?
                        </Link>
                      ) : null}
                    </div>
                    <Input
                      id={field.name}
                      name={field.name}
                      onBlur={field.handleBlur}
                      onChange={handleChange}
                      type="password"
                      value={field.state.value}
                    />
                    <FieldError errors={field.state.meta.errors} />
                  </Field>
                );
              }}
            </form.Field>

            <Field>
              <form.Subscribe selector={selectSubmitState}>
                {({ canSubmit, isSubmitting }) => (
                  <Button disabled={!canSubmit || isSubmitting} type="submit">
                    {isSubmitting ? "Submitting..." : "Sign In"}
                  </Button>
                )}
              </form.Subscribe>
              {onSwitchToSignUp ? (
                <Button className="mx-auto" onClick={onSwitchToSignUp} type="button" variant="link">
                  Need an account? Sign Up
                </Button>
              ) : null}
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
