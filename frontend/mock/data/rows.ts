// The rows the store holds, and one builder per row kind: a row's defaults
// live here only, the base data and the states give what differs.

import type { Account, BudgetCategory, BudgetTag, Composition, SyncConnection, SyncHealth } from "../../src/api/wire.ts";
import { TODAY, isoDay } from "./util.ts";

/** A ledger or lot row as stored; the API view joins the category and account. */
export type TxnRow = {
  id: string;
  t: number;
  type: string;
  description: string | null;
  amount: number;
  accountId: string;
  source: "cash" | "lot";
  holdingId: string | null;
  quantity: number | null;
  unitPrice: number | null;
  fee: number | null;
  categoryId: string | null;
  categorySource: "user" | "ai" | "pair" | null;
  categoryConfidence: string | null;
  needsReview: boolean;
  checked: boolean;
  isTransfer: boolean;
  isOrphanTransfer: boolean;
  tagIds: string[];
};

/** `seedKey` is the seed a category came from. A rename keeps it (unlike
 *  `defaultKey`), and the server never sends it. */
export type CategoryRow = Omit<BudgetCategory, "txCount"> & { sortOrder: number; seedKey: string | null };
export type TagRow = Omit<BudgetTag, "txCount">;

export type AccountRow = Omit<Account, "value" | "lastSyncAt" | "fxMissing" | "valueNative">;

/** A security; cash holdings are derived from the account balances. */
export type SecurityRow = {
  id: string;
  accountId: string;
  ticker: string;
  name: string;
  /** Daily closes, oldest first, one per day of `HISTORY_DAYS` ending today. */
  closes: number[];
  composition: Composition | null;
  /** The quantity the provider reports, when the lots don't explain it. */
  reportedQty?: number;
  /** Day index of the first price (a fund launched inside the history):
   *  no price is served before it, as Yahoo has none. */
  listedFrom?: number;
};

export type ConnectionRow = Omit<SyncConnection, "accounts"> & { providerKey: string };

/** The store's order for `txns`, as the server lists them. */
export function newestFirst(a: TxnRow, b: TxnRow): number {
  return b.t - a.t || b.id.localeCompare(a.id);
}

/** An uncategorised cash row. */
export function cashRow(id: string, row: Pick<TxnRow, "t" | "type" | "amount" | "accountId" | "description"> & Partial<TxnRow>): TxnRow {
  return {
    id,
    source: "cash",
    holdingId: null,
    quantity: null,
    unitPrice: null,
    fee: null,
    categoryId: null,
    categorySource: null,
    categoryConfidence: null,
    needsReview: false,
    checked: false,
    isTransfer: false,
    isOrphanTransfer: false,
    tagIds: [],
    ...row,
  };
}

/** A buy or sale as the ledger holds it: the cash it moved, no category
 *  (it isn't a budget row). */
export function lotRow(id: string, lot: { side: "buy" | "sell"; t: number; accountId: string; holdingId: string; quantity: number; unitPrice: number; fee: number }): TxnRow {
  const { side, quantity, unitPrice, fee, ...rest } = lot;
  const amount = side === "buy" ? -(quantity * unitPrice + fee) : quantity * unitPrice - fee;
  return { ...cashRow(id, { ...rest, type: side, amount, description: null }), source: "lot", quantity, unitPrice, fee };
}

/** A bank read today, verified. */
export function healthy(h: Partial<SyncHealth> = {}): SyncHealth {
  return { verified: true, lastUpdatedOn: isoDay(TODAY), state: null, errorMessage: null, nextRetryOn: null, ...h };
}

/** A healthy Powens connection, synced two hours ago. */
export function connectionRow(id: string, displayName: string, c: Partial<ConnectionRow> = {}): ConnectionRow {
  return {
    providerKey: "powens",
    id,
    displayName,
    status: "ok",
    lastSyncAt: Date.now() - 2 * 3_600_000,
    lastError: null,
    logo: null,
    canManage: true,
    health: healthy(),
    ...c,
  };
}

/** A euro account of `connection`. */
export function accountRow(
  id: string,
  connection: Pick<ConnectionRow, "id" | "displayName">,
  a: Pick<AccountRow, "name" | "color" | "typeKey"> & Partial<AccountRow>,
): AccountRow {
  return { id, connectionId: connection.id, currency: "EUR", sourceName: connection.displayName, sourceLogo: null, ...a };
}
