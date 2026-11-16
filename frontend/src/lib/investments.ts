import type { Holding, InvestmentReturns } from "../api/wire";
import type { ExposureHolding } from "./exposure";
import { fxExcludedCount } from "./holdings";

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
