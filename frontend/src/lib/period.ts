import { formatDate, zonedDay } from "./date";
import { localDay, monthBounds, monthStart, monthsBack, parseIsoDay } from "./month";

/** Month mode sends `?month=`, range mode `?from=&to=`. Only the month form returns comparisons. */
export type Period =
  | { mode: "month"; month: string } // "2026-09"
  | { mode: "range"; from: string; to: string }; // ISO days

export function currentMonth(today: Date = new Date()): string {
  return isoDay(today).slice(0, 7);
}

export function isoDay(d: Date): string {
  return zonedDay(d);
}

/** The one place the app formats from the i18n language, since a month name is a language question. */
export function monthLabel(month: string, language: string): string {
  const label = new Intl.DateTimeFormat(language, { month: "long", year: "numeric" }).format(
    monthStart(month),
  );
  // Standing alone as a label, it starts with a capital like the English one.
  return label.charAt(0).toLocaleUpperCase(language) + label.slice(1);
}

/** One label means one window everywhere. "This year" stops at today. */
export type RangePreset =
  | "thisMonth"
  | "last3Months"
  | "last6Months"
  | "last12Months"
  | "thisYear"
  | "lastYear";

/** Resolved at call time so a session left open overnight doesn't offer yesterday's window. */
export function presetRange(key: RangePreset, today: Date = new Date()): { from: string; to: string } {
  const day = isoDay(today);
  today = parseIsoDay(day);
  const year = today.getFullYear();
  const rolling = (months: number) => ({ from: localDay(monthsBack(today, months)), to: day });
  switch (key) {
    case "thisMonth":
      return monthBounds(day.slice(0, 7));
    case "last3Months":
      return rolling(3);
    case "last6Months":
      return rolling(6);
    case "last12Months":
      return rolling(12);
    case "thisYear":
      return { from: `${year}-01-01`, to: day };
    case "lastYear":
      return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
  }
}

export function periodBounds(p: Period): { from: string; to: string } {
  return p.mode === "month" ? monthBounds(p.month) : { from: p.from, to: p.to };
}

/** A range anchors the trend on the month of its end date. */
export function anchorMonth(p: Period): string {
  return p.mode === "month" ? p.month : p.to.slice(0, 7);
}

export function periodLabel(p: Period, language: string): string {
  if (p.mode === "month") return monthLabel(p.month, language);
  return `${formatDate(p.from)} → ${formatDate(p.to)}`;
}
