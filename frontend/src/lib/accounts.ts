import type { Account } from "../api/types";

export type ConnectionGroup = {
  connectionId: string;
  sourceName: string | null;
  sourceLogo: string | null;
  lastSyncAt: number | null;
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
        lastSyncAt: a.lastSyncAt,
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
