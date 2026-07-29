import { Button } from "@price-tracker/ui/components/button";
import { Input } from "@price-tracker/ui/components/input";
import { Label } from "@price-tracker/ui/components/label";
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
          router.push("/dashboard");
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
    <div className="mx-auto mt-10 w-full max-w-md p-6">
      <h1 className="mb-6 text-center font-bold text-3xl">Create Account</h1>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <form.Field name="name">
            {(field) => {
              const handleChange = (e: ChangeEvent<HTMLInputElement>) =>
                field.handleChange(e.target.value);
              return (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>Name</Label>
                  <Input
                    id={field.name}
                    name={field.name}
                    onBlur={field.handleBlur}
                    onChange={handleChange}
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
        </div>

        <div>
          <form.Field name="email">
            {(field) => {
              const handleChange = (e: ChangeEvent<HTMLInputElement>) =>
                field.handleChange(e.target.value);
              return (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>Email</Label>
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
                  {field.state.meta.errors.map((error) => (
                    <p className="text-red-500" key={error?.message}>
                      {error?.message}
                    </p>
                  ))}
                </div>
              );
            }}
          </form.Field>
        </div>

        <div>
          <form.Field name="password">
            {(field) => {
              const handleChange = (e: ChangeEvent<HTMLInputElement>) =>
                field.handleChange(e.target.value);
              return (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>Password</Label>
                  <Input
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
        </div>

        <form.Subscribe selector={selectSubmitState}>
          {({ canSubmit, isSubmitting }) => (
            <Button className="w-full" disabled={!canSubmit || isSubmitting} type="submit">
              {isSubmitting ? "Submitting..." : "Sign Up"}
            </Button>
          )}
        </form.Subscribe>
      </form>

      {onSwitchToSignIn ? (
        <div className="mt-4 text-center">
          <Button
            className="text-indigo-600 hover:text-indigo-800"
            onClick={onSwitchToSignIn}
            variant="link"
          >
            Already have an account? Sign In
          </Button>
        </div>
      ) : null}
    </div>
  );
}
