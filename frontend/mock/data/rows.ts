import type { Account, BudgetCategory, BudgetTag, Composition, SyncConnection, SyncHealth } from "../../src/api/wire.ts";
import { lotCashAmount } from "../../src/lib/lotRules.ts";
import { TODAY, isoDay } from "./util.ts";

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
  /** A `pair`-filed row with none lost its partner: an orphaned transfer. */
  pairId: string | null;
  tagIds: string[];
};

/** `seedKey` survives a rename (unlike `defaultKey`); the server never sends it. */
export type CategoryRow = Omit<BudgetCategory, "txCount"> & { sortOrder: number; seedKey: string | null };
export type TagRow = Omit<BudgetTag, "txCount">;

export type AccountRow = Omit<Account, "value" | "lastSyncAt" | "fxMissing" | "valueNative">;

export type SecurityRow = {
  id: string;
  accountId: string;
  ticker: string;
  name: string;
  closes: number[];
  composition: Composition | null;
  reportedQty?: number;
  /** Day index of the first price (a fund launched inside the history): none is served before it. */
  listedFrom?: number;
};

export type ConnectionRow = Omit<SyncConnection, "accounts"> & { providerKey: string };

export function newestFirst(a: TxnRow, b: TxnRow): number {
  return b.t - a.t || b.id.localeCompare(a.id);
}

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
    pairId: null,
    tagIds: [],
    ...row,
  };
}

export function lotRow(id: string, lot: { side: "buy" | "sell"; t: number; accountId: string; holdingId: string; quantity: number; unitPrice: number; fee: number }): TxnRow {
  const { side, quantity, unitPrice, fee, ...rest } = lot;
  const amount = Number(lotCashAmount(side, String(quantity), String(unitPrice), String(fee)));
  return { ...cashRow(id, { ...rest, type: side, amount, description: null }), source: "lot", quantity, unitPrice, fee };
}

export function healthy(h: Partial<SyncHealth> = {}): SyncHealth {
  return { verified: true, lastUpdatedOn: isoDay(TODAY), state: null, errorMessage: null, nextRetryOn: null, ...h };
}

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

export function accountRow(
  id: string,
  connection: Pick<ConnectionRow, "id" | "displayName">,
  a: Pick<AccountRow, "name" | "color" | "typeKey"> & Partial<AccountRow>,
): AccountRow {
  return { id, connectionId: connection.id, currency: "EUR", sourceName: connection.displayName, sourceLogo: null, ...a };
}
