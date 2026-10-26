import type { Account } from "../api/types";
import { formatPercent } from "./money";

export type DistributionRow = {
  account: Account;
  /** Share of what the accounts own. Null for an account at or below zero:
   *  an overdraft is not a slice of anything, and with nothing owned at all
   *  there is no whole to take a share of. */
  share: number | null;
};

/** The accounts as shares of what they own together, largest first. Only
 *  accounts above zero make up the whole, so the shares always add to 100 %
 *  even when one is overdrawn. */
export function distribution(accounts: Account[]): DistributionRow[] {
  const owned = accounts.reduce((sum, a) => sum + Math.max(0, Number(a.value)), 0);
  return [...accounts]
    .sort((a, b) => Number(b.value) - Number(a.value))
    .map((account) => {
      const value = Number(account.value);
      return { account, share: value > 0 ? value / owned : null };
    });
}

/** A share as a percentage, with "<0,1 %" for one too small to show rather
 *  than a "0 %" that reads as nothing. */
export function formatShare(share: number, fractionDigits: number): string {
  const smallest = 10 ** -(fractionDigits + 2);
  if (share > 0 && share < smallest / 2) return `<${formatPercent(smallest, { fractionDigits })}`;
  return formatPercent(share, { fractionDigits });
}
