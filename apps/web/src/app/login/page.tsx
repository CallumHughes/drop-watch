"use client";

import { useCallback, useState } from "react";

import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";

export default function LoginPage() {
  const [showSignIn, setShowSignIn] = useState(false);

  const handleSwitchToSignUp = useCallback(() => setShowSignIn(false), []);
  const handleSwitchToSignIn = useCallback(() => setShowSignIn(true), []);

  return showSignIn ? (
    <SignInForm onSwitchToSignUp={handleSwitchToSignUp} />
  ) : (
    <SignUpForm onSwitchToSignIn={handleSwitchToSignIn} />
  );
}
