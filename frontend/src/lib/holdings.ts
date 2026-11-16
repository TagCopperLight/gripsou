import type { TFunction } from "i18next";
import type { Holding } from "../api/wire";
import { currencySymbol } from "./currency";
import { sumDecimals } from "./decimal";
import { ACCOUNT_PALETTE } from "./palette";

/** Kinds this build has no label for show as sent. */
export function kindLabel(t: TFunction, kind: string): string {
  return t(`holdingKind.${kind}`, { defaultValue: kind });
}

/** One holding, or one currency's cash merged across accounts. */
export type HoldingLine = {
  key: string;
  /** All of the same instrument; instrument fields are read off the first. */
  holdings: [Holding, ...Holding[]];
  value: string;
  /** Null when any holding has no price at all. */
  valueNative: string | null;
  fxMissing: boolean;
  /** The account the line is in; null when it spans several. */
  account: { name: string; color: string } | null;
  /** The account type its accounts share; null when they differ. */
  accountType: string | null;
};

export const CASH_COLOR = ACCOUNT_PALETTE[0];

export function cashGlyph(currency: string): string | undefined {
  const symbol = currencySymbol(currency);
  return symbol === currency ? undefined : symbol;
}

function line(holdings: [Holding, ...Holding[]]): HoldingLine {
  const [first] = holdings;
  if (holdings.length === 1) {
    return {
      key: first.id,
      holdings,
      value: first.value,
      valueNative: first.valueNative,
      fxMissing: first.fxMissing,
      account: { name: first.accountName, color: first.accountColor },
      accountType: first.accountType,
    };
  }
  const natives = holdings.map((h) => h.valueNative);
  return {
    key: `cash:${first.ticker}`,
    holdings,
    value: sumDecimals(holdings.map((h) => h.value)),
    valueNative: natives.every((v) => v !== null) ? sumDecimals(natives) : null,
    fxMissing: holdings.some((h) => h.fxMissing),
    account: null,
    accountType: holdings.every((h) => h.accountType === first.accountType) ? first.accountType : null,
  };
}

export function holdingLines(holdings: Holding[]): HoldingLine[] {
  const lines: HoldingLine[] = [];
  const cash = new Map<string, [Holding, ...Holding[]]>();
  for (const h of holdings) {
    if (h.kind !== "cash") lines.push(line([h]));
    else if (cash.has(h.ticker)) cash.get(h.ticker)!.push(h);
    else cash.set(h.ticker, [h]);
  }
  return [...lines, ...[...cash.values()].map(line)];
}

export type HoldingSortKey = "asset" | "qty" | "value" | "pnl";
export type HoldingSort = { key: HoldingSortKey; dir: "asc" | "desc" };

// A new column starts A→Z for names, largest first for figures.
export function toggleHoldingSort(prev: HoldingSort | null, key: HoldingSortKey): HoldingSort {
  return prev?.key === key
    ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
    : { key, dir: key === "asset" ? "asc" : "desc" };
}

// Cash has no meaningful quantity or P/L; those lines always sort to the bottom.
function sortable(l: HoldingLine, key: "qty" | "pnl"): number | null {
  const h = l.holdings[0];
  if (h.kind === "cash") return null;
  return Number(key === "qty" ? h.qty : h.gl);
}

function compareNullable(a: number | null, b: number | null, mul: number): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return (a - b) * mul;
}

function compare(a: HoldingLine, b: HoldingLine, sort: HoldingSort): number {
  const mul = sort.dir === "asc" ? 1 : -1;
  switch (sort.key) {
    case "asset":
      return a.holdings[0].name.localeCompare(b.holdings[0].name) * mul;
    case "value":
      return (Number(a.value) - Number(b.value)) * mul;
    default:
      return compareNullable(sortable(a, sort.key), sortable(b, sort.key), mul);
  }
}

/** Holdings a converted total leaves out for want of a rate (worth zero in it). */
export function fxExcludedCount(holdings: Holding[]): number {
  return holdings.filter((h) => h.fxMissing).length;
}

export function holdingAccountTypes(holdings: Holding[]): string[] {
  return [...new Set(holdings.map((h) => h.accountType))];
}

export type HoldingFilter = {
  /** Null for every type. */
  accountType: string | null;
  query: string;
};

/** Filtering comes before the cash merge, so a filtered list's cash line is that type's cash only. */
export function shownHoldingLines(holdings: Holding[], filter: HoldingFilter, sort: HoldingSort | null): HoldingLine[] {
  const q = filter.query.trim().toLowerCase();
  const lines = holdingLines(
    holdings.filter(
      (h) =>
        (filter.accountType === null || h.accountType === filter.accountType) &&
        (q === "" || h.name.toLowerCase().includes(q) || h.ticker.toLowerCase().includes(q)),
    ),
  );
  return sort ? lines.sort((a, b) => compare(a, b, sort)) : lines;
}
