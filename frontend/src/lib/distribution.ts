import type { Account } from "../api/wire";
import { formatPercent } from "./money";

export type DistributionRow = {
  account: Account;
  /** Null for an account at or below zero. */
  share: number | null;
};

/** Only accounts above zero make up the whole, so shares add to 100 %. */
export function distribution(accounts: Account[]): DistributionRow[] {
  const owned = accounts.reduce((sum, a) => sum + Math.max(0, Number(a.value)), 0);
  return [...accounts]
    .sort((a, b) => Number(b.value) - Number(a.value))
    .map((account) => {
      const value = Number(account.value);
      return { account, share: value > 0 ? value / owned : null };
    });
}

export function sharesById(accounts: Account[]): Map<string, number | null> {
  return new Map(distribution(accounts).map((r) => [r.account.id, r.share]));
}

/** Shares up to this are too thin to draw; the lists still name them. */
export const MIN_DRAWN_SHARE = 0.01;

export function isDrawn(share: number | null): boolean {
  return share !== null && share > MIN_DRAWN_SHARE;
}

/** "<0,1 %" for a share too small to show, not "0 %". */
export function formatShare(share: number, fractionDigits: number): string {
  const smallest = 10 ** -(fractionDigits + 2);
  if (share > 0 && share < smallest / 2) return `<${formatPercent(smallest, { fractionDigits })}`;
  return formatPercent(share, { fractionDigits });
}
