import { afterEach, expect, it } from "vitest";
import { DEFAULT_PREFS, setPrefs } from "./prefs";
import { currentMonth, isoDay, presetRange, addMonths, periodLabel } from "./period";
import { formatDate, formatDay, calendarDay } from "./date";

afterEach(() => setPrefs(DEFAULT_PREFS));

it("uses the saved timezone at midnight and month boundaries", () => {
  setPrefs({ ...DEFAULT_PREFS, timeZone: "Europe/Paris" });
  const instant = new Date("2026-03-31T22:30:00Z");
  expect(isoDay(instant)).toBe("2026-04-01");
  expect(currentMonth(instant)).toBe("2026-04");
  expect(presetRange("thisYear", instant)).toEqual({ from: "2026-01-01", to: "2026-04-01" });
  expect(presetRange("last3Months", instant)).toEqual({ from: "2026-01-01", to: "2026-04-01" });
});

it("handles a timezone west of UTC and calendar arithmetic separately", () => {
  setPrefs({ ...DEFAULT_PREFS, timeZone: "America/Los_Angeles" });
  expect(isoDay(new Date("2026-01-01T01:00:00Z"))).toBe("2025-12-31");
  expect(addMonths("2026-01", -1)).toBe("2025-12");
  expect(periodLabel({ mode: "range", from: "2026-03-01", to: "2026-03-31" }, "en"))
    .toBe("01/03/2026 → 31/03/2026");
});

it("formats real timestamps in the saved timezone but preserves bare calendar dates", () => {
  setPrefs({ ...DEFAULT_PREFS, timeZone: "America/Los_Angeles" });
  expect(formatDate("2026-03-01")).toBe("01/03/2026");
  expect(formatDate("2026-03-01T01:00:00Z")).toBe("28/02/2026");
});

it("uses daylight-saving rules rather than a fixed Paris offset", () => {
  setPrefs({ ...DEFAULT_PREFS, timeZone: "Europe/Paris" });
  expect(isoDay(new Date("2026-01-31T22:30:00Z"))).toBe("2026-01-31");
  expect(isoDay(new Date("2026-07-31T22:30:00Z"))).toBe("2026-08-01");
});

it("preserves UTC-midnight calendar labels in charts and lots west of UTC", () => {
  setPrefs({ ...DEFAULT_PREFS, timeZone: "America/Los_Angeles" });
  const encodedDay = Date.parse("2026-03-01T00:00:00Z");
  expect(calendarDay(encodedDay)).toBe("2026-03-01");
  expect(formatDay(encodedDay)).toBe("01/03/2026");
});
