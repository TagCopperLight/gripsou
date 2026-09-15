import type { PricePoint, Lot } from "../api/types";

export type PositionPoint = { t: number; value: number; invested: number };

// Quantity held and invested capital at each price point.
//
// This file does NOT implement the cost-basis rule and must never start to.
// `meanPrice` and `unexplainedCost` are computed by `lot_basis` in the backend
// and arrive on the holding; all that happens here is a multiplication:
//
//     invested(t) = meanPrice x qty(t) + unexplainedCost
//
// The previous version added up raw transaction amounts, which made a sale
// reduce "invested" by its proceeds and folded realised profit into the basis —
// the exact thing the backend refuses to do (AUDIT.md D-1). That failure mode is
// now impossible here: nothing in this function reads a cash amount.
export function positionSeries(
  prices: PricePoint[],
  lots: Lot[],
  meanPrice: number,
  unexplainedCost: number,
  fallbackQty: number,
  fallbackInvested: number,
): PositionPoint[] {
  // No lots at all (a provider that reports balances only): a flat current
  // position is the best available answer.
  if (lots.length === 0) {
    return prices.map((p) => ({
      t: p.t,
      value: Number(p.price) * fallbackQty,
      invested: fallbackInvested,
    }));
  }
  // Points before the first lot are dropped — there was no position yet, and
  // charting one there is a lie.
  const firstLot = Math.min(...lots.map((l) => l.t));
  return prices
    .filter((p) => p.t >= firstLot)
    .map((p) => {
      let qty = 0;
      for (const l of lots) {
        if (l.t <= p.t) qty += l.side === "sell" ? -Number(l.qty) : Number(l.qty);
      }
      return {
        t: p.t,
        value: Number(p.price) * qty,
        invested: meanPrice * qty + unexplainedCost,
      };
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
