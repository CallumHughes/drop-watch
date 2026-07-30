import { Button } from "@price-tracker/ui/components/button";
import { Card, CardContent, CardHeader } from "@price-tracker/ui/components/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@price-tracker/ui/components/field";
import { Input } from "@price-tracker/ui/components/input";
import { useForm } from "@tanstack/react-form";
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

type SignUpBody = Parameters<typeof authClient.signUp.email>[0];

/**
 * @param invite - present when this form is reached through an invite link.
 *   The email comes locked to the invited address and the token rides along in
 *   the signup body for the server hook to honor.
 * @param onSwitchToSignIn - omitted on the invite page, where "sign in
 *   instead" makes no sense — the visitor is here precisely because they have
 *   no account.
 */
export default function SignUpForm({
  invite,
  onSwitchToSignIn,
}: {
  invite?: { email: string; token: string };
  onSwitchToSignIn?: () => void;
}) {
  const router = useRouter();
  const { isPending } = authClient.useSession();

  const form = useForm({
    defaultValues: {
      email: invite ? invite.email : "",
      name: "",
      password: "",
    },
    onSubmit: async ({ value }) => {
      // `inviteToken` rides along in the body: better-auth's sign-up schema
      // ends in `.and(z.record(z.string(), z.any()))`, so unknown keys reach
      // the server's before-hook via ctx.body and are dropped before the user
      // insert. The cast exists only because the client types don't model
      // pass-through keys.
      const body = {
        email: value.email,
        name: value.name,
        password: value.password,
        ...(invite ? { inviteToken: invite.token } : {}),
      } as SignUpBody;

      await authClient.signUp.email(body, {
        onError: (error) => {
          toast.error(error.error.message || error.error.statusText);
        },
        onSuccess: async () => {
          // With a mailer configured the server never auto-signs-in on signup
          // (requireEmailVerification), even though invited accounts are born
          // verified. Rather than sniffing the response for a session token,
          // invite mode always signs in explicitly — on mailer-off installs
          // it is a harmless re-authentication with known-good credentials.
          if (invite) {
            const signedIn = await authClient.signIn.email({
              email: value.email,
              password: value.password,
            });
            if (signedIn.error) {
              toast.error(signedIn.error.message || "Account created — please sign in.");
              router.push("/login");
              return;
            }
          }
          router.push("/");
          toast.success("Sign up successful");
        },
      });
    },
    validators: {
      onSubmit: z.object({
        email: z.email("Invalid email address"),
        name: z.string().min(2, "Name must be at least 2 characters"),
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
        <h1 className="cn-font-heading font-medium text-xl">Create Account</h1>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <form.Field name="name">
              {(field) => {
                const handleChange = (e: ChangeEvent<HTMLInputElement>) =>
                  field.handleChange(e.target.value);
                return (
                  <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
                    <FieldLabel htmlFor={field.name}>Name</FieldLabel>
                    <Input
                      id={field.name}
                      name={field.name}
                      onBlur={field.handleBlur}
                      onChange={handleChange}
                      value={field.state.value}
                    />
                    <FieldError errors={field.state.meta.errors} />
                  </Field>
                );
              }}
            </form.Field>

            <form.Field name="email">
              {(field) => {
                const handleChange = (e: ChangeEvent<HTMLInputElement>) =>
                  field.handleChange(e.target.value);
                return (
                  <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
                    <FieldLabel htmlFor={field.name}>Email</FieldLabel>
                    {/* Locked in invite mode as UX only — the address the token
                        was issued for is enforced by the server's signup hook,
                        not by this attribute. */}
                    <Input
                      disabled={invite !== undefined}
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
                    <FieldLabel htmlFor={field.name}>Password</FieldLabel>
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
                    {isSubmitting ? "Submitting..." : "Sign Up"}
                  </Button>
                )}
              </form.Subscribe>
              {onSwitchToSignIn ? (
                <Button className="mx-auto" onClick={onSwitchToSignIn} type="button" variant="link">
                  Already have an account? Sign In
                </Button>
              ) : null}
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
