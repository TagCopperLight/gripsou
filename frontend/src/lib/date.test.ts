import { describe, it, expect, vi, afterEach } from "vitest";
import { formatRelative, formatDate, parseDate } from "./date";
import { DEFAULT_PREFS } from "../api/wire";
import { setPrefs } from "./prefs";

const NOW = new Date("2026-06-15T12:00:00Z").getTime();
const ago = (ms: number) => NOW - ms;
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

describe("formatRelative", () => {
  afterEach(() => vi.useRealTimers());

  it("returns 'Never synced' for null", () => {
    expect(formatRelative(null)).toBe("Never synced");
  });

  it("formats recent times relatively", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(formatRelative(ago(30 * 1000))).toBe("just now");
    expect(formatRelative(ago(5 * MIN))).toBe("5 min ago");
    expect(formatRelative(ago(3 * HOUR))).toBe("3 h ago");
    expect(formatRelative(ago(1 * DAY))).toBe("yesterday");
    expect(formatRelative(ago(4 * DAY))).toBe("4 days ago");
    expect(formatRelative(ago(10 * DAY))).toBe("last week");
  });

  it("falls back to an absolute date past two weeks", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(formatRelative(ago(30 * DAY))).toBe("16/05/2026");
  });
});

describe("formatDate (prefs-driven)", () => {
  afterEach(() => setPrefs(DEFAULT_PREFS));

  it("uses the prefs date pattern by default", () => {
    const d = new Date("2026-05-16T00:00:00Z").getTime();
    setPrefs({ ...DEFAULT_PREFS, dateFormat: "MM/DD/YYYY" });
    expect(formatDate(d)).toBe("05/16/2026");
  });

  it("an explicit pattern overrides prefs", () => {
    const d = new Date("2026-05-16T00:00:00Z").getTime();
    expect(formatDate(d, { pattern: "YYYY-MM-DD" })).toBe("2026-05-16");
  });
});

describe("parseDate", () => {
  it("reads text in the given pattern as an ISO day", () => {
    expect(parseDate("16/05/2026", "DD/MM/YYYY")).toBe("2026-05-16");
    expect(parseDate("05/16/2026", "MM/DD/YYYY")).toBe("2026-05-16");
    expect(parseDate("2026.05.16", "YYYY.MM.DD")).toBe("2026-05-16");
    expect(parseDate("16-05-26", "DD-MM-YY")).toBe("2026-05-16");
  });

  it("rejects text that does not fit the pattern", () => {
    expect(parseDate("", "DD/MM/YYYY")).toBeNull();
    expect(parseDate("16/05/20", "DD/MM/YYYY")).toBeNull();
    expect(parseDate("2026-05-16", "DD/MM/YYYY")).toBeNull();
  });

  it("rejects impossible dates", () => {
    expect(parseDate("31/02/2026", "DD/MM/YYYY")).toBeNull();
    expect(parseDate("29/02/2025", "DD/MM/YYYY")).toBeNull();
    expect(parseDate("29/02/2024", "DD/MM/YYYY")).toBe("2024-02-29");
    expect(parseDate("10/13/2026", "DD/MM/YYYY")).toBeNull();
  });

  it("round-trips formatDate", () => {
    for (const pattern of ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "DD.MM.YYYY"]) {
      expect(parseDate(formatDate("2026-03-09", { pattern }), pattern)).toBe("2026-03-09");
    }
  });
});
