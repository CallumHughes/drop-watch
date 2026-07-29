import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { closeDb, insertUser, truncateUsers } from "../test/helpers";
import { signupOpen } from "./signup";

describe("signupOpen", () => {
  beforeEach(async () => {
    await truncateUsers();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("is open when no account exists", async () => {
    await expect(signupOpen()).resolves.toBe(true);
  });

  it("slams shut the moment the first account exists", async () => {
    await insertUser({ email: "admin@example.com" });
    await expect(signupOpen()).resolves.toBe(false);
  });

  it("counts unverified accounts too", async () => {
    await insertUser({ email: "unverified@example.com", emailVerified: false });
    await expect(signupOpen()).resolves.toBe(false);
  });
});
