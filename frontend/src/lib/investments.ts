import type { Holding, InvestmentReturns } from "../api/types";
import type { ExposureHolding } from "./exposure";
import { fxExcludedCount } from "./holdings";

/** What the Investments page reads off the holdings: the securities it is
 *  about (cash never counts here), how many of them are left out of the
 *  donuts for want of a rate, and whether there is anything to show at all. */
export function investmentsView(holdings: Holding[], returns: InvestmentReturns) {
  const securities = holdings.filter((h) => h.kind !== "cash");
  const held: ExposureHolding[] = securities.map((h) => ({
    name: h.name,
    kind: h.kind,
    value: Number(h.value),
    composition: h.composition,
  }));
  return {
    held,
    excluded: fxExcludedCount(securities),
    empty: held.length === 0 && returns.accounts.length === 0,
  };
}
