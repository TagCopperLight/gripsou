import { describe, it, expect } from "vitest";

import {
  addMonths,
  anchorMonth,
  currentMonth,
  monthBounds,
  monthLabel,
  periodBounds,
  periodLabel,
  presetRange,
} from "./period";

describe("currentMonth", () => {
  it("formats the given day as YYYY-MM", () => {
    expect(currentMonth(new Date(2026, 8, 22))).toBe("2026-09");
  });

  it("zero-pads a single-digit month", () => {
    expect(currentMonth(new Date(2026, 0, 3))).toBe("2026-01");
  });
});

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

describe("monthLabel", () => {
  it("names the month in English", () => {
    expect(monthLabel("2026-09", "en")).toBe("September 2026");
  });

  it("names the month in French", () => {
    // French month names are lower-case; that is correct French, not a bug.
    expect(monthLabel("2026-09", "fr")).toBe("septembre 2026");
  });
});

describe("periodBounds", () => {
  it("expands a month to its first and last day", () => {
    expect(periodBounds({ mode: "month", month: "2026-09" })).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
    });
  });

  it("passes a range through untouched", () => {
    expect(
      periodBounds({ mode: "range", from: "2026-03-14", to: "2026-04-02" }),
    ).toEqual({ from: "2026-03-14", to: "2026-04-02" });
  });
});

describe("anchorMonth", () => {
  it("is the month itself in month mode", () => {
    expect(anchorMonth({ mode: "month", month: "2026-09" })).toBe("2026-09");
  });

  it("is the month containing `to` in range mode", () => {
    // A range has no anchor of its own, so the trend anchors on the
    // month its end date falls in rather than disappearing.
    expect(anchorMonth({ mode: "range", from: "2025-11-04", to: "2026-03-18" })).toBe(
      "2026-03",
    );
  });
});

describe("periodLabel", () => {
  it("labels a month by name", () => {
    expect(periodLabel({ mode: "month", month: "2026-09" }, "en")).toBe("September 2026");
  });

  it("labels a range as two formatted dates", () => {
    // Uses the user's date-format preference, whose default pattern is
    // DD/MM/YYYY.
    expect(periodLabel({ mode: "range", from: "2026-03-14", to: "2026-04-02" }, "en")).toBe(
      "14/03/2026 → 02/04/2026",
    );
  });
});

describe("presetRange", () => {
  const today = new Date(2026, 8, 21); // 21 September 2026, local

  it("makes every 'last N months' a rolling window ending today", () => {
    expect(presetRange("last3Months", today)).toEqual({ from: "2026-06-21", to: "2026-09-21" });
    expect(presetRange("last6Months", today)).toEqual({ from: "2026-03-21", to: "2026-09-21" });
    expect(presetRange("last12Months", today)).toEqual({ from: "2025-09-21", to: "2026-09-21" });
  });

  it("clamps the start day when the month back is shorter", () => {
    expect(presetRange("last3Months", new Date(2026, 4, 31))).toEqual({
      from: "2026-02-28",
      to: "2026-05-31",
    });
  });

  it("runs 'this year' to today and 'last year' over the whole year", () => {
    expect(presetRange("thisYear", today)).toEqual({ from: "2026-01-01", to: "2026-09-21" });
    expect(presetRange("lastYear", today)).toEqual({ from: "2025-01-01", to: "2025-12-31" });
  });

  it("keeps 'this month' as the whole calendar month", () => {
    expect(presetRange("thisMonth", today)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });
});
