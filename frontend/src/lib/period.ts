import { formatDate, zonedDay } from "./date";
import { localDay, monthBounds, monthStart, monthsBack, parseIsoDay } from "./month";

/** The Overview's period. The two variants map one-to-one onto the two request
 *  forms of `/api/budget/summary`: month mode sends `?month=`, range mode sends
 *  `?from=&to=`. They are NOT interchangeable — only the month form comes back
 *  with comparisons against the previous month and the 12-month average. */
export type Period =
  | { mode: "month"; month: string } // "2026-09"
  | { mode: "range"; from: string; to: string }; // ISO days

/** Current month in the user's saved timezone. */
export function currentMonth(today: Date = new Date()): string {
  return isoDay(today).slice(0, 7);
}

/** Current calendar day in the user's saved timezone. */
export function isoDay(d: Date): string {
  return zonedDay(d);
}

/** "September 2026" / "septembre 2026". A month name is inherently a language
 *  question, so this is the one place the app formats from the i18n language
 *  rather than from the user's separator/pattern preferences. */
export function monthLabel(month: string, language: string): string {
  const label = new Intl.DateTimeFormat(language, { month: "long", year: "numeric" }).format(
    monthStart(month),
  );
  // French writes months lower-case ("octobre 2026"); standing alone as a
  // label, it starts with a capital like the English one.
  return label.charAt(0).toLocaleUpperCase(language) + label.slice(1);
}

/** Every named date range the app offers, on both Overview and Transactions,
 *  so one label always means one window. "Last N months" is a rolling window
 *  (the same date N months ago → today); "this year" stops at today, so a
 *  range never reaches into months that have not happened yet. */
export type RangePreset =
  | "thisMonth"
  | "last3Months"
  | "last6Months"
  | "last12Months"
  | "thisYear"
  | "lastYear";

/** Resolved at call time rather than at module load, so a session left open
 *  overnight does not offer yesterday's window. Inclusive ISO day bounds. */
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

/** The month `/api/budget/trend` anchors on. A range has no anchor of its own,
 *  so it anchors on the month containing its end date — the last twelve months
 *  stay meaningful context even though a range has no comparisons. */
export function anchorMonth(p: Period): string {
  return p.mode === "month" ? p.month : p.to.slice(0, 7);
}

/** What the period reads as: a month name, or the two dates in the user's own
 *  date format. Also the text of the "Selected period" chip a deep link sets. */
export function periodLabel(p: Period, language: string): string {
  if (p.mode === "month") return monthLabel(p.month, language);
  return `${formatDate(p.from)} → ${formatDate(p.to)}`;
}
