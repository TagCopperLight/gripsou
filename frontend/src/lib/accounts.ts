import type { TFunction } from "i18next";
import type { Account, AccountSeries } from "../api/wire";

// A type added to the database but not yet to the locale files shows its key.
export function accountTypeLabel(t: TFunction, key: string): string {
  return t(`accountTypes.${key}`, { defaultValue: key });
}

export type ConnectionGroup = {
  connectionId: string;
  sourceName: string;
  sourceLogo: string | null;
  total: number;
  accounts: Account[];
};

/** Accounts keep their incoming order (the API sends them by value, descending). */
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

const LEGEND_MAX = 5;

/** One at zero over the whole range has no band, so it is left out of the tooltip and legend; one emptied during the range keeps its history. */
export function bySize(series: AccountSeries): AccountSeries["accounts"] {
  const last = series.points.at(-1)?.values ?? {};
  return series.accounts
    .filter((a) => series.points.some((p) => Number(p.values[a.id] ?? 0) !== 0))
    .sort((a, b) => Number(last[b.id] ?? 0) - Number(last[a.id] ?? 0));
}

/** Only ever more than one left out: naming a sixth takes no more room than "+1 other". */
export function legendAccounts(series: AccountSeries, max = LEGEND_MAX): { shown: AccountSeries["accounts"]; others: string[] } {
  const sorted = bySize(series);
  if (sorted.length <= max + 1) return { shown: sorted, others: [] };
  return { shown: sorted.slice(0, max), others: sorted.slice(max).map((a) => a.name) };
}
