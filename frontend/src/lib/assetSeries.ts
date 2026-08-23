import type { PricePoint, Purchase } from "../api/types";

export type PositionPoint = { t: number; value: number; invested: number };

// Quantity held and invested-capital at each price point: sum the lots whose
// purchase time is at or before that point. Points before the first lot are
// dropped — there was no position yet, and charting one there is a lie.
export function positionSeries(
  prices: PricePoint[],
  purchases: Purchase[],
  fallbackQty: number,
  fallbackInvested: number,
): PositionPoint[] {
  // No lots at all (a provider that reports balances only): flat current
  // position is the best available answer.
  if (purchases.length === 0) {
    return prices.map((p) => ({
      t: p.t,
      value: Number(p.price) * fallbackQty,
      invested: fallbackInvested,
    }));
  }
  const firstLot = Math.min(...purchases.map((lot) => lot.t));
  return prices
    .filter((p) => p.t >= firstLot)
    .map((p) => {
      let qty = 0;
      let invested = 0;
      for (const lot of purchases) {
        if (lot.t <= p.t) {
          const q = Number(lot.qty);
          qty += lot.type === "sell" ? -q : q;
          // `lot.invested` is the raw `transaction.amount`: NEGATIVE for a buy
          // (cash out), positive for a sale. Negating it gives money-in, which
          // is what a line labelled "Invested" has to mean.
          invested -= Number(lot.invested);
        }
      }
      return { t: p.t, value: Number(p.price) * qty, invested };
    });
}
