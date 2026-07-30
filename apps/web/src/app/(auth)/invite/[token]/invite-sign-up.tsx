"use client";

import SignUpForm from "@/components/sign-up-form";

/**
 * The thin client half of the invite page: the server component validates the
 * token and this mounts the interactive form with it. No "sign in instead"
 * switch — an invitee by definition has no account yet.
 */
export default function InviteSignUp({ email, token }: { email: string; token: string }) {
  return <SignUpForm invite={{ email, token }} />;
}
