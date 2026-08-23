import type { PricePoint, Purchase } from "../api/types";

export type PositionPoint = { t: number; value: number; invested: number };

// Quantity held and invested-capital at each price point: sum the lots whose
// purchase time is at or before that point. Falls back to the full position
// when all lots predate the visible window.
export function positionSeries(
  prices: PricePoint[],
  purchases: Purchase[],
  fallbackQty: number,
  fallbackInvested: number,
): PositionPoint[] {
  return prices.map((p) => {
    let qty = 0;
    let invested = 0;
    for (const lot of purchases) {
      if (lot.t <= p.t) {
        const q = Number(lot.qty);
        qty += lot.type === "sell" ? -q : q;
        // `lot.invested` is the raw `transaction.amount`: NEGATIVE for a buy
        // (cash out), positive for a sale. Negating it gives money-in, which is
        // what a line labelled "Invested" has to mean — before this, a position
        // built entirely of buys charted as a negative invested line.
        invested -= Number(lot.invested);
      }
    }
    if (qty === 0) {
      qty = fallbackQty;
      invested = fallbackInvested;
    }
    return { t: p.t, value: Number(p.price) * qty, invested };
  });
}
