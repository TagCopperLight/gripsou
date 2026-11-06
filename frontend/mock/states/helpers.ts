// Tweaks several states share.

import { cat } from "../data/base.ts";
import { accountRow, cashRow, newestFirst, type AccountRow, type ConnectionRow, type SecurityRow, type TxnRow } from "../data/rows.ts";
import { daysAgo, isoDay } from "../data/util.ts";
import type { Store } from "../store.ts";
import { queueForReview } from "../views/budget.ts";
import { lotsOf } from "../views/portfolio.ts";

export function security(store: Store, id: string): SecurityRow {
  const s = store.securities.find((x) => x.id === id);
  if (!s) throw new Error(`no security ${id}`);
  return s;
}

/** A connection, if an earlier state left it in. */
export function connection(store: Store, id: string): ConnectionRow | undefined {
  return store.connections.find((c) => c.id === id);
}

/** Shares the recorded lots explain. */
export function lotShares(store: Store, holdingId: string): number {
  return lotsOf(store, holdingId).reduce((q, l) => q + (l.side === "sell" ? -1 : 1) * Number(l.qty), 0);
}

/** No accounts, holdings or transactions; connections left as they are. */
export function emptyHousehold(store: Store): void {
  store.accounts = [];
  store.securities = [];
  store.txns = [];
  store.openingCash = {};
}

/** A new user's household: nothing connected, nothing held. */
export function nothingConnected(store: Store): void {
  emptyHousehold(store);
  store.connections = [];
}

/** Bank data last updated `days` ago. */
export function staleDay(days: number): string {
  return isoDay(daysAgo(days));
}

/** One more account of the connection, holding `cash` (with no transaction,
 *  from the start of the history to today); returns its id. */
export function addAccount(store: Store, connectionId: string, cash: number, a: Pick<AccountRow, "name" | "color" | "typeKey"> & Partial<AccountRow>): string {
  const c = connection(store, connectionId);
  if (!c) throw new Error(`no connection ${connectionId}`);
  const id = store.ids.next("account");
  store.accounts.push(accountRow(id, c, a));
  store.openingCash[id] = cash;
  return id;
}

/** One more cash row, filed by the user under `categoryKey` (null: none),
 *  sorted in by date. */
export function addRow(store: Store, categoryKey: string | null, row: Parameters<typeof cashRow>[1]): TxnRow {
  const categoryId = categoryKey === null ? null : cat(store.categories, categoryKey);
  const added = cashRow(store.ids.next("txn"), { categoryId, categorySource: categoryId ? "user" : null, ...row });
  store.txns.push(added);
  store.txns.sort(newestFirst);
  return added;
}

/** Puts the last 30 days' cash rows `pick` selects (up to `count`) in the
 *  review queue as the AI's unsure guesses into `categoryKey` (null: it
 *  abstained). */
export function queue(store: Store, count: number, categoryKey: string | null, pick: (x: TxnRow) => boolean = () => true): TxnRow[] {
  const from = daysAgo(30);
  const categoryId = categoryKey === null ? null : cat(store.categories, categoryKey);
  return store.txns
    .filter((x) => x.source === "cash" && x.t >= from && !x.needsReview && pick(x))
    .slice(0, count)
    .map((x, i) => queueForReview(x, categoryId, categoryId ? (0.5 + (i % 3) * 0.05).toFixed(2) : null));
}
