import { adminClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  // Mirrors the server's admin plugin so `role` is typed on the session user —
  // the UI only reads it (admin-only menu items and pages), never sets it.
  plugins: [adminClient()],
});
