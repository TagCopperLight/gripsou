// Response shapes from the read API. Money/quantities are decimal strings;
// timestamps are epoch-ms. Components format strings; charts convert to number.

import type { TFunction } from "i18next";

export type HoldingKind = "cash" | "etf" | "equity" | "crypto";

export const KIND_LABEL_KEY: Record<HoldingKind, string> = {
  cash: "holdingKind.cash",
  etf: "holdingKind.etf",
  equity: "holdingKind.equity",
  crypto: "holdingKind.crypto",
};

// Categories are data-driven: the backend sends a stable `key` plus an English
// `label`. We translate `categories.<key>` and fall back to the backend label
// when a key has no locale entry yet (e.g. a category added to the DB but not
// the locale files).
export function categoryLabel(t: TFunction, key: string, fallback: string): string {
  return t(`categories.${key}`, { defaultValue: fallback });
}

export type NetWorthPoint = { t: number; netWorth: string; invested: string };
export type NetWorthSummary = {
  netWorth: string;
  invested: string;
  gainAbs: string;
  gainPct: string;
};
export type NetWorthResponse = { points: NetWorthPoint[]; summary: NetWorthSummary };

export type DistributionAccount = {
  id: string;
  name: string;
  category: string;
  categoryLabel: string;
  color: string;
  value: string;
};

export type Holding = {
  id: string;
  ticker: string;
  name: string;
  kind: HoldingKind;
  logo: string;
  accountId: string;
  accountName: string;
  accountColor: string;
  category: string;
  categoryLabel: string;
  qty: string;
  price: string;
  invested: string;
  value: string;
  gl: string;
  glPct: string;
  spark: string[] | null;
};

export type PricePoint = { t: number; price: string };
export type Purchase = { t: number; qty: string; price: string; invested: string };

export type Account = {
  id: string;
  name: string;
  color: string;
  typeKey: string;
  typeLabel: string;
  value: string;
  lastSyncAt: number | null;
};

export type AccountType = {
  key: string;
  label: string;
  category: string;
  categoryLabel: string;
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
};

// The authenticated user's own profile, returned by POST /auth/login.
export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
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
