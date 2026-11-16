// As the server's `lot_basis` SQL function.

import type { Lot } from "../../src/api/wire.ts";

export type Basis = {
  meanPrice: number | null;
  explainedQty: number;
  basis: number;
  realised: number;
};

export function explainedQty(lots: Lot[], asOf = Infinity): number {
  return lots.filter((l) => l.t <= asOf).reduce((q, l) => q + (l.side === "sell" ? -1 : 1) * Number(l.qty), 0);
}

/** Fee-inclusive, over every buy whatever its date. */
export function meanBuyPrice(lots: Lot[]): number | null {
  const buys = lots.filter((l) => l.side === "buy");
  const boughtQty = buys.reduce((q, l) => q + Number(l.qty), 0);
  return boughtQty === 0 ? null : buys.reduce((c, l) => c + Number(l.qty) * Number(l.price) + Number(l.fee), 0) / boughtQty;
}

/** Lots that don't explain `held` leave the rest of `providerBasis` carried flat backward. */
export function lotBasis(lots: Lot[], held: number, providerBasis: number, asOf = Infinity): Basis {
  const meanPrice = meanBuyPrice(lots);
  const explained = explainedQty(lots, asOf);
  const realised =
    meanPrice === null ? 0
    : lots
      .filter((l) => l.side === "sell" && l.t <= asOf)
      .reduce((s, l) => s + Number(l.qty) * (Number(l.price) - meanPrice) - Number(l.fee), 0);
  const explainedNow = explainedQty(lots);
  const basis =
    meanPrice === null ? providerBasis
    : explainedNow === held ? meanPrice * explained
    : meanPrice * explained + (providerBasis - meanPrice * explainedNow);
  return { meanPrice, explainedQty: explained, basis, realised };
}
