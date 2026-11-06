// Calendar arithmetic on "YYYY-MM" months and ISO days. Imports nothing, so the
// mock server can use it too. Local Dates here are calendar containers, not
// real instants.

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function localDay(d: Date): string {
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
 *  west of UTC — e.g. `new Date("2026-03-14")` becomes 2026-03-13T16:00 in PST. */
export function parseIsoDay(isoDay: string): Date {
  const [year, month, day] = isoDay.split("-");
  return new Date(Number(year), Number(month) - 1, Number(day));
}

export function addMonths(month: string, delta: number): string {
  const { year, monthIndex } = parse(month);
  return localDay(new Date(year, monthIndex + delta, 1)).slice(0, 7);
}

/** `d` shifted back `months` months, with the day clamped to the target
 *  month's length. Without the clamp the Date constructor silently rolls
 *  over — 29 Feb minus 12 months would land on 1 March. */
export function monthsBack(d: Date, months: number): Date {
  const y = d.getFullYear();
  const m = d.getMonth();
  // Day 0 of the following month is the last day of the target month.
  const lastDay = new Date(y, m - months + 1, 0).getDate();
  return new Date(y, m - months, Math.min(d.getDate(), lastDay));
}

/** First and last day of `month`, as ISO days. */
export function monthBounds(month: string): { from: string; to: string } {
  const { year, monthIndex } = parse(month);
  const last = new Date(year, monthIndex + 1, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${pad(last)}` };
}
