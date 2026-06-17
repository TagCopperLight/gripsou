import { describe, it, expect, vi, afterEach } from "vitest";
import { formatRelative, formatDate } from "./date";
import { DEFAULT_PREFS, setPrefs } from "./prefs";

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
