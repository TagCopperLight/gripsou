import type { Allocation } from "../api/wire";

/** Whole percents, largest first, plus the remainder that makes exactly 100%:
 *  Boursorama lists only top holdings. Sorted here because its order breaks
 *  once repeated lines are merged. */
export function allocationPercents(items: Allocation[]): {
  listed: { name: string; percent: number }[];
  other: number;
} {
  const listed = [...items]
    .sort((a, b) => b.weight - a.weight)
    .map((a) => ({ name: a.name, percent: Math.round(a.weight * 100) }));
  return { listed, other: 100 - listed.reduce((sum, s) => sum + s.percent, 0) };
}
