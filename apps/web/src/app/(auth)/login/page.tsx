"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import Loader from "@/components/loader";
import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";
import { orpc } from "@/utils/orpc";

/**
 * Sign-in, plus account creation only while this instance has no account at
 * all.
 *
 * The sign-up form exists purely to bootstrap an install whose seed script was
 * never run. Once an account exists the switch disappears and later accounts
 * arrive by invite — and the endpoint refuses regardless, since hiding a form
 * is presentation, not security.
 */
export default function LoginPage() {
  const signupOpen = useQuery(orpc.signupOpen.queryOptions());
  const [showSignUp, setShowSignUp] = useState(false);

  const handleSwitchToSignUp = useCallback(() => setShowSignUp(true), []);
  const handleSwitchToSignIn = useCallback(() => setShowSignUp(false), []);

  if (signupOpen.isPending) {
    return <Loader />;
  }

  if (showSignUp && signupOpen.data) {
    return <SignUpForm onSwitchToSignIn={handleSwitchToSignIn} />;
  }

  return <SignInForm onSwitchToSignUp={signupOpen.data ? handleSwitchToSignUp : undefined} />;
}
