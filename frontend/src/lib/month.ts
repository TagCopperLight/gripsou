// Imports nothing, so the mock server can use it. Local Dates are calendar containers, not instants.

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

export function monthStart(month: string): Date {
  const { year, monthIndex } = parse(month);
  return new Date(year, monthIndex, 1);
}

/** A bare ISO day in `new Date(string)` parses as UTC midnight, a day early west of UTC. */
export function parseIsoDay(isoDay: string): Date {
  const [year, month, day] = isoDay.split("-");
  return new Date(Number(year), Number(month) - 1, Number(day));
}

export function addMonths(month: string, delta: number): string {
  const { year, monthIndex } = parse(month);
  return localDay(new Date(year, monthIndex + delta, 1)).slice(0, 7);
}

/** Day clamped to the target month's length: the Date constructor would roll 29 Feb minus 12 months to 1 March. */
export function monthsBack(d: Date, months: number): Date {
  const y = d.getFullYear();
  const m = d.getMonth();
  // Day 0 of the following month is the last day of the target month.
  const lastDay = new Date(y, m - months + 1, 0).getDate();
  return new Date(y, m - months, Math.min(d.getDate(), lastDay));
}

export function monthBounds(month: string): { from: string; to: string } {
  const { year, monthIndex } = parse(month);
  const last = new Date(year, monthIndex + 1, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${pad(last)}` };
}
