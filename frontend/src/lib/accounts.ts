import type { Account, AccountSeries } from "../api/types";

export type ConnectionGroup = {
  connectionId: string;
  sourceName: string | null;
  sourceLogo: string | null;
  total: number;
  accounts: Account[];
};

/** Accounts grouped by their connection, biggest subtotal first. Accounts keep
 * their incoming order (the API sends them by value, descending). */
export function groupByConnection(accounts: Account[]): ConnectionGroup[] {
  const groups = new Map<string, ConnectionGroup>();
  for (const a of accounts) {
    let g = groups.get(a.connectionId);
    if (!g) {
      g = {
        connectionId: a.connectionId,
        sourceName: a.sourceName,
        sourceLogo: a.sourceLogo,
        total: 0,
        accounts: [],
      };
      groups.set(a.connectionId, g);
    }
    g.total += Number(a.value);
    g.accounts.push(a);
  }
  return [...groups.values()].sort((x, y) => y.total - x.total);
}

/** How many accounts the chart's legend names before "+N others". */
export const LEGEND_MAX = 5;

/** The chart's accounts, biggest first at the range's end: the stack's
 *  bottom band, the tooltip's first line, the legend's first name. One at
 *  zero over the whole range has no band, so it's left out of the tooltip
 *  and the legend too; one emptied during the range keeps its history. */
export function bySize(series: AccountSeries): AccountSeries["accounts"] {
  const last = series.points.at(-1)?.values ?? {};
  return series.accounts
    .filter((a) => series.points.some((p) => Number(p.values[a.id] ?? 0) !== 0))
    .sort((a, b) => Number(last[b.id] ?? 0) - Number(last[a.id] ?? 0));
}

/** The accounts the chart's legend names: the biggest at the range's end,
 *  and how many more are left out (only ever more than one: naming a sixth
 *  takes no more room than "+1 other"). */
export function legendAccounts(series: AccountSeries, max = LEGEND_MAX): { shown: AccountSeries["accounts"]; others: string[] } {
  const sorted = bySize(series);
  if (sorted.length <= max + 1) return { shown: sorted, others: [] };
  return { shown: sorted.slice(0, max), others: sorted.slice(max).map((a) => a.name) };
}
