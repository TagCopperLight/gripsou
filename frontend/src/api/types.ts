// Response shapes from the read API. Money/quantities are decimal strings;
// timestamps are epoch-ms. Components format strings; charts convert to number.

export type HoldingKind = "cash" | "etf" | "equity" | "crypto";

export const KIND_LABEL: Record<HoldingKind, string> = {
  cash: "Cash",
  etf: "ETF",
  equity: "Stock",
  crypto: "Crypto",
};

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
