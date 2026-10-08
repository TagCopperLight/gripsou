// How long a return has been running, for the faint line under an annualised
// figure: an annualised rate means little without the time it covers.

export type Span = { years: number; months: number; days: number };

/** Whole years and months from `from` to `to` (ISO dates), or days when it is
 *  under a month. */
export function spanBetween(from: string, to: string): Span {
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  let months =
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  if (months < 1) {
    const days = Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000));
    return { years: 0, months: 0, days };
  }
  return { years: Math.floor(months / 12), months: months % 12, days: 0 };
}
