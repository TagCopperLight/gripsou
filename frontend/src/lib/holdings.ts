import type { Holding } from "../api/types";
import { ACCOUNT_PALETTE } from "./palette";

/**
 * Collapse cash holdings into a single line per currency. Cash is the same
 * instrument across accounts (EUR is EUR), so the holdings list shows one
 * summed "Cash" row rather than one per account; the per-account breakdown
 * lives on the Accounts tab. Non-cash holdings pass through untouched, and a
 * currency held in only one account keeps its original (per-account) row.
 *
 * `multipleLabel` is the translated "Multiple accounts" string shown in the
 * account column of a merged row.
 */
export function aggregateCash(holdings: Holding[], multipleLabel: string): Holding[] {
  const cash = holdings.filter((h) => h.kind === "cash");
  if (cash.length === 0) return holdings;
  const rest = holdings.filter((h) => h.kind !== "cash");

  const groups = new Map<string, Holding[]>();
  for (const h of cash) {
    const group = groups.get(h.ticker);
    if (group) group.push(h);
    else groups.set(h.ticker, [h]);
  }

  const merged: Holding[] = [];
  for (const items of groups.values()) {
    if (items.length === 1) {
      merged.push({ ...items[0] });
      continue;
    }
    const value = items.reduce((sum, h) => sum + Number(h.value), 0);
    const qty = items.reduce((sum, h) => sum + Number(h.qty), 0);
    const first = items[0];
    merged.push({
      ...first,
      id: `cash:${first.ticker}`,
      accountId: "",
      accountName: multipleLabel,
      accountColor: ACCOUNT_PALETTE[0],
      logo: first.logo,
      category: "cash",
      categoryLabel: "Cash",
      qty: String(qty),
      invested: String(value),
      value: String(value),
      gl: "0",
      glPct: "0",
      spark: null,
    });
  }

  return [...rest, ...merged];
}
