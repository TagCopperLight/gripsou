// Response shapes from the read API. Money/quantities are decimal strings;
// timestamps are epoch-ms. Components format strings; charts convert to number.

import type { TFunction } from "i18next";
import type { UserPrefs } from "../lib/prefs";

export type HoldingKind = "cash" | "etf" | "equity" | "crypto";

export const KIND_LABEL_KEY: Record<HoldingKind, string> = {
  cash: "holdingKind.cash",
  etf: "holdingKind.etf",
  equity: "holdingKind.equity",
  crypto: "holdingKind.crypto",
};

// Account types are data-driven: the backend sends a stable `key` plus an
// English `label`. We translate `accountTypes.<key>` and fall back to the
// backend label when a key has no locale entry yet (e.g. a type added to the DB
// but not the locale files).
export function accountTypeLabel(t: TFunction, key: string, fallback: string): string {
  return t(`accountTypes.${key}`, { defaultValue: fallback });
}

export type NetWorthPoint = { t: number; netWorth: string; invested: string };
export type NetWorthSummary = {
  netWorth: string;
  invested: string;
  gainAbs: string;
  gainPct: string;
  fxMissing: boolean;
};
export type NetWorthResponse = { points: NetWorthPoint[]; summary: NetWorthSummary };

export type DistributionAccount = {
  id: string;
  name: string;
  accountType: string;
  accountTypeLabel: string;
  color: string;
  value: string;
  /** A holding in this slice could not be valued, so the slice understates. */
  fxMissing: boolean;
};

export type Allocation = { name: string; weight: number };
export type Composition = { countries: Allocation[]; sectors: Allocation[] };

export type Holding = {
  id: string;
  ticker: string;
  name: string;
  kind: HoldingKind;
  logo: string | null;
  accountId: string;
  accountName: string;
  accountColor: string;
  accountType: string;
  accountTypeLabel: string;
  qty: string;
  /** Unit price, denominated in `priceCurrency` — NOT in `currency`. */
  price: string;
  /** The instrument's quote currency. Identity/labelling only. */
  currency: string;
  /** Currency of the unit price and the price chart (the price domain). */
  priceCurrency: string;
  /** The account's currency (the amount domain): `investedNative` and every
   *  transaction figure on this holding are in it. */
  accountCurrency: string;
  invested: string;
  investedNative: string;
  value: string;
  gl: string;
  glPct: string;
  fxMissing: boolean;
  spark: string[] | null;
  composition: Composition | null;
  /** Shares no recorded lot explains (§9.1). "0" when the position is fully
   *  accounted for. A non-zero value drives the fill-in badge. */
  unexplainedQty: string;
};

export type PricePoint = { t: number; price: string };
export type Purchase = {
  id: string;
  t: number;
  type: "buy" | "sell";
  qty: string;
  price: string;
  /** Raw `transaction.amount`: NEGATIVE for a buy, positive for a sell. Negate
   *  once at the point of use — never treat it as an invested figure directly. */
  invested: string;
  /** True when the user entered this row; only these may be deleted. */
  manual: boolean;
};

export type Account = {
  id: string;
  name: string;
  color: string;
  typeKey: string;
  typeLabel: string;
  value: string;
  lastSyncAt: number | null;
  sourceName: string | null;
  sourceLogo: string | null;
  fxMissing: boolean;
};

export type AccountType = {
  key: string;
  label: string;
};

export type AccountSeries = {
  accounts: { id: string; name: string; color: string }[];
  points: { t: number; values: Record<string, string> }[];
};

export type User = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
  joinedAt: number;
  isSelf: boolean;
  avatar?: string;
};

// The authenticated user's own profile, returned by POST /auth/login.
export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
  prefs: UserPrefs;
};

// One active login session, from GET /api/auth/sessions.
export type Session = {
  id: string;
  device: string;
  ip: string | null;
  createdAt: number;
  lastActiveAt: number;
  remembered: boolean;
  current: boolean;
};

export type SyncStatus = "ok" | "syncing" | "error" | "pending" | "awaiting";

export type SyncAccount = {
  id: string;
  name: string;
  color: string | null;
  typeLabel: string;
  value: string;
  lastSyncAt: number | null;
};

export type SyncConnection = {
  id: string;
  displayName: string;
  status: SyncStatus;
  lastSyncAt: number | null;
  lastError: string | null;
  accounts: SyncAccount[];
  logo: string | null;
};

export type ProviderGroup = {
  providerKey: string;
  providerName: string;
  connections: SyncConnection[];
};

export function flattenConnections(
  groups: ProviderGroup[] | undefined,
): SyncConnection[] {
  return (groups ?? []).flatMap((g) => g.connections);
}

export function hasSyncing(groups: ProviderGroup[] | undefined): boolean {
  return flattenConnections(groups).some(
    (c) => c.status === "syncing" || c.status === "awaiting",
  );
}

export function hasError(groups: ProviderGroup[] | undefined): boolean {
  return flattenConnections(groups).some((c) => c.status === "error");
}

export type Provider = {
  key: string;
  displayName: string;
  description: string | null;
  enabled: boolean;
};

export type EnabledProvider = {
  key: string;
  displayName: string;
  description: string | null;
};

export type Transaction = {
  id: string;
  t: number;
  type: string;
  description: string | null;
  /** Decimal string, denominated in the ACCOUNT's own currency (see `currency`),
   *  never the user's reporting currency — do not relabel it. */
  amount: string;
  currency: string;
  accountId: string;
  accountName: string;
  accountColor: string | null;
};

export type TransactionQuery = {
  search?: string;
  accountId?: string;
  type?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};
