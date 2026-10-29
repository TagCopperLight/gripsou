// Response shapes from the read API. Money/quantities are decimal strings;
// timestamps are epoch-ms. Components format strings; charts convert to number.

import type { TFunction } from "i18next";
import type { UserPrefs } from "../lib/prefs";

export type HoldingKind = "cash" | "etf" | "equity";

export const KIND_LABEL_KEY: Record<HoldingKind, string> = {
  cash: "holdingKind.cash",
  etf: "holdingKind.etf",
  equity: "holdingKind.equity",
};

// Account types are data-driven: the backend sends a stable key. A type added
// to the database but not yet to the locale files shows its key.
export function accountTypeLabel(t: TFunction, key: string): string {
  return t(`accountTypes.${key}`, { defaultValue: key });
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
  /** `qty × price` in `priceCurrency`, before any conversion: what the
   *  holding shows when `fxMissing` leaves `value` at zero. Null with no
   *  price at all. */
  valueNative: string | null;
  gl: string;
  glPct: string;
  fxMissing: boolean;
  spark: string[] | null;
  composition: Composition | null;
  /** Shares no recorded lot explains. "0" when the position is fully
   *  accounted for. A non-zero value drives the fill-in badge. */
  unexplainedQty: string;
  /** Fee-inclusive mean buy price, amount domain. "0" with no recorded buys. */
  meanPrice: string;
  /** The part of the basis no lot explains, amount domain. "0" when the lots
   *  account for the position exactly. */
  unexplainedCost: string;
};

export type PricePoint = {
  t: number;
  /** In the price row's currency (`Holding.priceCurrency`). */
  price: string;
  /** The same price in the account's currency at that day's rates; null when
   *  a rate is missing. */
  accountPrice: string | null;
  /** The same price in the reader's currency; null when a rate is missing. */
  reportingPrice: string | null;
};

export type Lot = {
  id: string;
  /** Epoch milliseconds at UTC midnight of the acquisition date. */
  t: number;
  side: "buy" | "sell";
  qty: string;
  price: string;
  /** Acquisition fee, amount domain. "0" when not recorded. Part of the cost
   *  basis: French PRMP includes it, and so does the provider's own figure. */
  fee: string;
  /** True when the user entered this row; only these may be deleted. */
  manual: boolean;
};

/** A lot inferred from a quantity change and its one matching transaction.
 *  Already in the save endpoint's row shape; `date` is `YYYY-MM-DD`. */
export type LotSuggestion = {
  type: "buy" | "sell";
  date: string;
  quantity: string;
  unitPrice: string;
  fee: string;
};

export type BasisPreview = {
  meanPrice: string;
  invested: string;
  realised: string;
  /** Null while today's price or exchange rate is unknown. */
  unrealised: string | null;
  /** The same figures in the reader's currency; null while that rate is unknown. */
  reporting: {
    meanPrice: string;
    invested: string;
    realised: string;
    unrealised: string | null;
  } | null;
};

export type Account = {
  id: string;
  connectionId: string;
  name: string;
  color: string;
  typeKey: string;
  value: string;
  currency: string;
  valueNative: string | null;
  lastSyncAt: number | null;
  sourceName: string | null;
  sourceLogo: string | null;
  fxMissing: boolean;
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
  /** False until the user finished or skipped the post-invite welcome screen. */
  welcomeDone: boolean;
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

export type SyncHealth = {
  verified: boolean;
  lastUpdatedOn: string | null;
  state: string | null;
  errorMessage: string | null;
  nextRetryOn: string | null;
};

export type SyncAccount = {
  health?: SyncHealth | null;
  id: string;
  name: string;
  color: string;
  typeKey: string;
  value: string;
  lastSyncAt: number | null;
};

export type SyncConnection = {
  canManage?: boolean;
  health?: SyncHealth | null;
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

/** One value a provider needs (Settings → Server → API keys). A secret's
 *  value never comes back from the server: only whether one is saved. */
export type ApiKeyField =
  | { key: string; secret: false; value: string | null }
  | { key: string; secret: true; set: boolean };

export type ApiKeyProvider = {
  key: string;
  displayName: string;
  fields: ApiKeyField[];
};

export type EnabledProvider = {
  key: string;
  displayName: string;
  description: string | null;
};

export type TransactionTag = { id: string; name: string; color: string | null };

export type Transaction = {
  id: string;
  t: number;
  type: string;
  description: string | null;
  /** Decimal string, denominated in the ACCOUNT's own currency (see `currency`),
   *  never the user's reporting currency — do not relabel it. */
  amount: string;
  /** `amount` in the reader's currency at the transaction's own date; null
   *  when the account's or the reader's currency has no rate that day. The
   *  list is capped at 200 rows, so summing these client-side for an explicit
   *  selection is cheap. */
  amountReporting: string | null;
  currency: string;
  accountId: string;
  accountName: string;
  accountColor: string;
  /** "cash" for a ledger row, "lot" for a purchase or sale. Lot rows carry the
   *  four instrument fields below and no description. */
  source: "cash" | "lot";
  ticker: string | null;
  /** The instrument's logo on a lot row; null on a cash row. */
  logo: string | null;
  quantity: string | null;
  unitPrice: string | null;
  fee: string | null;
  categoryId: string | null;
  categoryName: string | null;
  /** Translate this when present; fall back to `categoryName`. */
  categoryDefaultKey: string | null;
  categoryColor: string | null;
  categoryIcon: string | null;
  categoryKind: "expense" | "income" | "neutral" | null;
  /** Who set the category: the user, the AI, or the transfer-pairing pass. */
  categorySource: "user" | "ai" | "pair" | null;
  /** Decimal string, never a float. */
  categoryConfidence: string | null;
  /** Derived server-side: an AI guess under the threshold that nobody confirmed. */
  needsReview: boolean;
  checked: boolean;
  /** One half of an auto-paired internal transfer. */
  isTransfer: boolean;
  /** The pairing pass categorised this row but the link is gone — someone
   *  corrected the other half, so this one nets against nothing. Mutually
   *  exclusive with `isTransfer` by construction. */
  isOrphanTransfer: boolean;
  tags: TransactionTag[];
};

export type TypeBucket = "all" | "in" | "out" | "lots";

export type TransactionQuery = {
  search?: string;
  accountId?: string;
  /** Replaces the retired per-kind `type` parameter. */
  bucket?: TypeBucket;
  from?: string;
  to?: string;
  /** Several ids mean *either* of them (OR), server-side. */
  categoryIds?: string[];
  /** Several ids mean *all* of them (AND), server-side. */
  tagIds?: string[];
  uncategorized?: boolean;
  needsReview?: boolean;
  /** Internal transfers are hidden unless this is set — the only filter here
   *  whose absence means *less* than everything. */
  includeTransfers?: boolean;
  limit?: number;
  offset?: number;
};

export type TransactionCounts = {
  matching: number;
  total: number;
  uncategorized: number;
  /** The cash rows among `matching`: what "select all shown" selects (a buy
   *  or sale carries no budget). */
  selectable: number;
  /** Signed sum of the `selectable` rows in the reader's reporting currency. */
  matchingTotal: string;
  fxMissing: boolean;
};

/** A `TransactionQuery` minus the pagination the infinite query owns — i.e. the
 * filter set the user picks, which is also what the query key is built from. */
export type TransactionFilterQuery = Omit<TransactionQuery, "limit" | "offset">;

// GET /investments/returns. `annualised` is a ratio per year ("0.0712"), null
// when it can't be computed; `since` is the first purchase it covers.
export type ReturnFigures = {
  annualised: string | null;
  since: string | null;
  /** Every purchase, fees included. Null when a rate is missing for one. */
  invested: string | null;
  /** Every sale (after fees) and dividend. Null when a rate is missing for one. */
  received: string | null;
  value: string;
  /** value + received − invested: the money the return annualises. */
  gain: string | null;
  /** `gain` over `invested`. */
  gainPct: string | null;
  /** Holdings left out of every figure: their purchases and sales don't
   *  explain what is held. */
  excludedHistory: number;
  /** Holdings left out of every figure: no exchange rate to value them. */
  excludedRate: number;
};

export type MissingHolding = { id: string; name: string };

export type ReturnAccount = ReturnFigures & {
  id: string;
  name: string;
  color: string;
  /** The bank or broker; "" when unknown. */
  source: string;
  /** The holdings `excludedHistory` counts. */
  missing: MissingHolding[];
};

export type InvestmentReturns = {
  /** The user's today (YYYY-MM-DD), which periods run up to. */
  today: string;
  total: ReturnFigures;
  accounts: ReturnAccount[];
};

export type MfaRequired = { mfaRequired: true; challenge: string };

export type Passkey = { id: string; name: string; createdAt: number; lastUsedAt: number | null };
export type MfaStatus = { totp: boolean; recoveryRemaining: number; passkeys: Passkey[] };
export type TotpSetup = { secret: string; qrSvg: string };
