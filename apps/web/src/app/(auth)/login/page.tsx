import { emailEnabled } from "@drop-watch/email";
import { connection } from "next/server";

import LoginClient from "./login-client";

export default async function LoginPage() {
  await connection();

  return <LoginClient emailEnabled={emailEnabled()} />;
}
