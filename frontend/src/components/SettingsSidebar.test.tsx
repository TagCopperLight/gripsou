import { describe, it, expect } from "vitest";
import { settingsNavItems } from "./settingsNav";

describe("settingsNavItems", () => {
  it("defines the four settings sections in order", () => {
    expect(settingsNavItems.map((item) => item.to)).toEqual([
      "/settings/general",
      "/settings/account",
      "/settings/users",
      "/settings/server",
    ]);
  });

  it("marks only Users and Server as admin-only", () => {
    const adminOnly = settingsNavItems
      .filter((item) => item.adminOnly)
      .map((item) => item.to);
    expect(adminOnly).toEqual(["/settings/users", "/settings/server"]);
  });
});
