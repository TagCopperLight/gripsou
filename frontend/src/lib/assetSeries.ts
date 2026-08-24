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

// Return over the displayed window, rebased so the window starts at 0%:
// profit made since the start, over the capital that was at work for it.
// ponytail: simple-Dietz denominator (start value + net contributions since),
// not time-weighted — a big deposit late in the window still flatters it
// slightly. Swap for TWR if that ever matters.
export function windowReturn(
  values: [number, number][],
  invested: [number, number][],
): [number, number][] {
  const investedAt = new Map(invested);
  const v0 = values[0]?.[1] ?? 0;
  const inv0 = investedAt.get(values[0]?.[0]) ?? 0;
  return values.map(([t, v]) => {
    const inv = investedAt.get(t) ?? inv0;
    const gain = v - inv - (v0 - inv0);
    const base = v0 + (inv - inv0);
    return [t, base ? gain / base : 0];
  });
}
