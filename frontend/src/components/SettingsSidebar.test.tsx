import { describe, it, expect } from "vitest";
import { settingsNavItems } from "./settingsNav";

describe("settingsNavItems", () => {
  it("defines the six settings sections in order", () => {
    expect(settingsNavItems.map((item) => item.to)).toEqual([
      "/settings/general",
      "/settings/account",
      "/settings/connections",
      "/settings/budget",
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

  it("offers Budget right after Connections", () => {
    const labels = settingsNavItems
      .filter((item) => !item.adminOnly)
      .map((item) => item.labelKey);
    expect(labels).toEqual([
      "settings.general.title",
      "settings.account.title",
      "settings.connections.title",
      "settings.budget.title",
    ]);
  });
});
