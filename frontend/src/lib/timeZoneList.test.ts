import { describe, expect, it } from "vitest";

import { timeZoneOptions } from "./timeZoneList";

// A winter day: Paris is UTC+1, New York UTC-5.
const WINTER = new Date(Date.UTC(2026, 0, 15, 12));

describe("timeZoneOptions", () => {
  it("names each zone by its city and today's offset, west to east", () => {
    const options = timeZoneOptions("Europe/Paris", "en", WINTER);
    const labels = options.map((o) => o.label);
    expect(labels).toContain("Paris (UTC+1)");
    expect(labels).toContain("Kolkata (UTC+5:30)");
    expect(labels).toContain("Buenos Aires (UTC-3)");
    expect(labels.indexOf("New York (UTC-5)")).toBeLessThan(labels.indexOf("Paris (UTC+1)"));
  });

  it("keeps a saved zone that isn't one of the main ones", () => {
    const options = timeZoneOptions("Asia/Kathmandu", "en", WINTER);
    expect(options).toContainEqual({ value: "Asia/Kathmandu", label: "Kathmandu (UTC+5:45)" });
  });

  it("names the cities in French for a French reader", () => {
    const labels = timeZoneOptions("Europe/Paris", "fr", WINTER).map((o) => o.label);
    expect(labels).toContain("Londres (UTC+0)");
    expect(labels).toContain("La Réunion (UTC+4)");
  });
});
