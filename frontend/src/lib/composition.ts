import type { Allocation } from "../api/wire";

/** An allocation as whole percents, largest first, plus the remainder that
 *  takes it to exactly 100%: Boursorama lists only the top holdings, so the
 *  listed weights sum to less, and rounding each slice leaves a leftover too.
 *  Sorted here because Boursorama's own order breaks once repeated lines are
 *  merged (a 13 % line after an 8 % one). */
export function allocationPercents(items: Allocation[]): {
  listed: { name: string; percent: number }[];
  other: number;
} {
  const listed = [...items]
    .sort((a, b) => b.weight - a.weight)
    .map((a) => ({ name: a.name, percent: Math.round(a.weight * 100) }));
  return { listed, other: 100 - listed.reduce((sum, s) => sum + s.percent, 0) };
}
