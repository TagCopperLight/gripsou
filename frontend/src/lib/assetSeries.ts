import type { PricePoint, Lot } from "../api/types";

export type PositionPoint = { t: number; value: number; invested: number };

// Quantity held and invested capital at each price point, both in the
// account's currency: `accountPrice`, not `price`, so the value line and the
// invested line (lots are recorded in the account's currency) compare like
// with like on a foreign listing. Points without a rate are dropped.
//
// This file does NOT implement the cost-basis rule and must never start to.
// `meanPrice` and `unexplainedCost` are computed by `lot_basis` in the backend
// and arrive on the holding; all that happens here is a multiplication:
//
//     invested(t) = meanPrice x qty(t) + unexplainedCost
//
// The previous version added up raw transaction amounts, which made a sale
// reduce "invested" by its proceeds and folded realised profit into the basis —
// the exact thing the backend refuses to do. That failure mode is
// now impossible here: nothing in this function reads a cash amount.
export function positionSeries(
  prices: PricePoint[],
  lots: Lot[],
  meanPrice: number,
  unexplainedCost: number,
  fallbackQty: number,
  fallbackInvested: number,
  domain: "account" | "reporting" = "account",
): PositionPoint[] {
  // No lots at all (a provider that reports balances only): a flat current
  // position is the best available answer.
  // In the reader's currency each day carries its own account->reader rate
  // (reportingPrice / accountPrice), which also converts the invested line;
  // a day missing either price is dropped.
  const reporting = domain === "reporting";
  const priced = prices
    .filter((p) => p.accountPrice !== null && (!reporting || p.reportingPrice !== null))
    .map((p) => ({
      t: p.t,
      price: Number(reporting ? p.reportingPrice : p.accountPrice),
      rate: reporting ? Number(p.reportingPrice) / Number(p.accountPrice) : 1,
    }));
  if (lots.length === 0) {
    return priced.map((p) => ({
      t: p.t,
      value: p.price * fallbackQty,
      invested: fallbackInvested * p.rate,
    }));
  }
  // Points before the first lot are dropped — there was no position yet, and
  // charting one there is a lie.
  const firstLot = Math.min(...lots.map((l) => l.t));
  return priced
    .filter((p) => p.t >= firstLot)
    .map((p) => {
      let qty = 0;
      for (const l of lots) {
        if (l.t <= p.t) qty += l.side === "sell" ? -Number(l.qty) : Number(l.qty);
      }
      return {
        t: p.t,
        value: p.price * qty,
        invested: (meanPrice * qty + unexplainedCost) * p.rate,
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
