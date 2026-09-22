import { formatDate } from "./date";

/** The Overview's period. The two variants map one-to-one onto the two request
 *  forms of `/api/budget/summary`: month mode sends `?month=`, range mode sends
 *  `?from=&to=`. They are NOT interchangeable — the server answers
 *  `comparable: true` only for the month form (handoff §2). */
export type Period =
  | { mode: "month"; month: string } // "2026-09"
  | { mode: "range"; from: string; to: string }; // ISO days

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** `YYYY-MM` for the month `today` falls in. Built from local getters, not
 *  `toISOString()`, which converts to UTC first and can shift the month for
 *  anyone east or west of it — the same trap `lib/budgetFilters.ts` documents. */
export function currentMonth(today: Date = new Date()): string {
  return `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;
}

function parse(month: string): { year: number; monthIndex: number } {
  const [y, m] = month.split("-");
  return { year: Number(y), monthIndex: Number(m) - 1 };
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
  const d = new Date(year, monthIndex + delta, 1);
  return currentMonth(d);
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
  const { year, monthIndex } = parse(month);
  return new Intl.DateTimeFormat(language, { month: "long", year: "numeric" }).format(
    new Date(year, monthIndex, 1),
  );
}

export function periodBounds(p: Period): { from: string; to: string } {
  return p.mode === "month" ? monthBounds(p.month) : { from: p.from, to: p.to };
}

/** The month `/api/budget/trend` anchors on. A range has no anchor of its own,
 *  so it anchors on the month containing its end date — the last twelve months
 *  stay meaningful context even when the figures above are not comparable. */
export function anchorMonth(p: Period): string {
  return p.mode === "month" ? p.month : p.to.slice(0, 7);
}

/** What the period reads as: a month name, or the two dates in the user's own
 *  date format. Also the text of the "Selected period" chip a deep link sets. */
export function periodLabel(p: Period, language: string): string {
  if (p.mode === "month") return monthLabel(p.month, language);
  return `${formatDate(parseIsoDay(p.from))} → ${formatDate(parseIsoDay(p.to))}`;
}
