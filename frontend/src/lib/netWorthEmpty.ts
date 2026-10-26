import { flattenConnections, type ProviderGroup } from "../api/types";

/** Why the net worth card has nothing to plot. */
export type NetWorthEmptyKind = "noConnection" | "syncing" | "nothingCameIn";

/** The server sends no points while the user has no accounts. Read off the
 *  connections: none yet, one still bringing its first accounts in, or
 *  connected but nothing gripsou can show (a failed first sync, or a bank
 *  holding only loans and cards, which are skipped). */
export function netWorthEmptyKind(groups: ProviderGroup[]): NetWorthEmptyKind {
  const conns = flattenConnections(groups);
  if (conns.length === 0) return "noConnection";
  if (conns.some((c) => c.status === "syncing" || c.status === "awaiting" || c.status === "pending")) return "syncing";
  return "nothingCameIn";
}
