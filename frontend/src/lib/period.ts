import { formatDate, zonedDay } from "./date";

/** The Overview's period. The two variants map one-to-one onto the two request
 *  forms of `/api/budget/summary`: month mode sends `?month=`, range mode sends
 *  `?from=&to=`. They are NOT interchangeable — only the month form comes back
 *  with comparisons against the previous month and the 12-month average. */
export type Period =
  | { mode: "month"; month: string } // "2026-09"
  | { mode: "range"; from: string; to: string }; // ISO days

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Current month in the user's saved timezone. */
export function currentMonth(today: Date = new Date()): string {
  return isoDay(today).slice(0, 7);
}

/** Current calendar day in the user's saved timezone. */
export function isoDay(d: Date): string {
  return zonedDay(d);
}

// Local Dates below are calendar arithmetic containers, not real instants.
function localDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parse(month: string): { year: number; monthIndex: number } {
  const [y, m] = month.split("-");
  return { year: Number(y), monthIndex: Number(m) - 1 };
}

/** The first day of `month`, as a local Date. */
export function monthStart(month: string): Date {
  const { year, monthIndex } = parse(month);
  return new Date(year, monthIndex, 1);
}

/** ISO day string → Date built from local parts. A bare ISO day string passed to
 *  `new Date(string)` is parsed as UTC midnight, which shifts the date for viewers
 *  west of UTC — e.g. `new Date("2026-03-14")` becomes 2026-03-13T16:00 in PST.
 *  Building the Date from local parts avoids this trap. */
function parseIsoDay(isoDay: string): Date {
  const [year, month, day] = isoDay.split("-");
  return new Date(Number(year), Number(month) - 1, Number(day));
}

export function addMonths(month: string, delta: number): string {
  const { year, monthIndex } = parse(month);
  // Day 1 is always valid, so the Date constructor's month roll-over does the
  // year arithmetic for us with no clamping needed.
  return localDay(new Date(year, monthIndex + delta, 1)).slice(0, 7);
}

/** `d` shifted back `months` months, with the day clamped to the target
 *  month's length. Without the clamp the Date constructor silently rolls
 *  over — 29 Feb minus 12 months would land on 1 March. */
function monthsBack(d: Date, months: number): Date {
  const y = d.getFullYear();
  const m = d.getMonth();
  // Day 0 of the following month is the last day of the target month.
  const lastDay = new Date(y, m - months + 1, 0).getDate();
  return new Date(y, m - months, Math.min(d.getDate(), lastDay));
}

/** First and last day of `month`, as ISO days. */
export function monthBounds(month: string): { from: string; to: string } {
  const { year, monthIndex } = parse(month);
  // Day 0 of the following month is the last day of this one.
  const last = new Date(year, monthIndex + 1, 0).getDate();
  return {
    from: `${month}-01`,
    to: `${month}-${pad(last)}`,
  };
}

/** "September 2026" / "septembre 2026". A month name is inherently a language
 *  question, so this is the one place the app formats from the i18n language
 *  rather than from the user's separator/pattern preferences. */
export function monthLabel(month: string, language: string): string {
  return new Intl.DateTimeFormat(language, { month: "long", year: "numeric" }).format(
    monthStart(month),
  );
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
