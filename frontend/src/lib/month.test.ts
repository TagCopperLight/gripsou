import { describe, it, expect } from "vitest";

import { addMonths, monthBounds } from "./month";

describe("addMonths", () => {
  it("steps forward inside a year", () => {
    expect(addMonths("2026-09", 1)).toBe("2026-10");
  });

  it("steps backward across a year boundary", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });

  it("steps forward across a year boundary", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
  });

  it("steps by more than twelve", () => {
    expect(addMonths("2026-09", -13)).toBe("2025-08");
  });
});

describe("monthBounds", () => {
  it("spans a 30-day month", () => {
    expect(monthBounds("2026-09")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("spans a leap February", () => {
    expect(monthBounds("2024-02")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
  });

  it("spans a non-leap February", () => {
    expect(monthBounds("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
});
