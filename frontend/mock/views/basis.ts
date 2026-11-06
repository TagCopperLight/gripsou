// The cost basis of one holding, as the server's `lot_basis` gives it
// (backend/migrations/0022_lot_basis.sql, redefined in 0025): every screen's
// basis comes from here, as on the server.

import type { Lot } from "../../src/api/wire.ts";

export type Basis = {
  /** Null with no buy. */
  meanPrice: number | null;
  /** What the lots explain on the day. */
  explainedQty: number;
  basis: number;
  /** Sales' proceeds minus fees, over the mean price. */
  realised: number;
};

/** Shares the lots explain at the end of `asOf` (every lot by default). */
export function explainedQty(lots: Lot[], asOf = Infinity): number {
  return lots.filter((l) => l.t <= asOf).reduce((q, l) => q + (l.side === "sell" ? -1 : 1) * Number(l.qty), 0);
}

/** Fee-inclusive, over every buy whatever its date; null with no buy. */
export function meanBuyPrice(lots: Lot[]): number | null {
  const buys = lots.filter((l) => l.side === "buy");
  const boughtQty = buys.reduce((q, l) => q + Number(l.qty), 0);
  return boughtQty === 0 ? null : buys.reduce((c, l) => c + Number(l.qty) * Number(l.price) + Number(l.fee), 0) / boughtQty;
}

/** `held` and `providerBasis` are what the provider reports today. When the
 *  lots don't explain `held`, the part of `providerBasis` they don't explain
 *  is carried flat backward. */
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
