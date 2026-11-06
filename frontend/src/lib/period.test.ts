import { beforeEach, afterEach } from "vitest";
import { DEFAULT_PREFS } from "../api/wire";
import { setPrefs } from "./prefs";

// These calendar-arithmetic fixtures use local Date constructors.
beforeEach(() => setPrefs({ ...DEFAULT_PREFS, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }));
afterEach(() => setPrefs(DEFAULT_PREFS));

import { describe, it, expect } from "vitest";

import {
  anchorMonth,
  currentMonth,
  monthLabel,
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

describe("monthLabel", () => {
  it("names the month in English", () => {
    expect(monthLabel("2026-09", "en")).toBe("September 2026");
  });

  it("capitalises the French month, which stands alone as a label", () => {
    expect(monthLabel("2026-09", "fr")).toBe("Septembre 2026");
  });
});

describe("anchorMonth", () => {
  it("is the month containing `to` in range mode", () => {
    // A range has no anchor of its own, so the trend anchors on the
    // month its end date falls in rather than disappearing.
    expect(anchorMonth({ mode: "range", from: "2025-11-04", to: "2026-03-18" })).toBe(
      "2026-03",
    );
  });
});

describe("periodLabel", () => {
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

  it("keeps 'this month' as the whole calendar month", () => {
    expect(presetRange("thisMonth", today)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });
});
