import type { PricePoint } from "../api/types";

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

type Point = [number, number];

/** The asset tab's chart and header: the unit price over the window, in the
 *  price row's currency or, when `reporting`, in the reader's (days without a
 *  rate dropped). The header is the current price, or the converted series'
 *  last point. */
export function priceChart(prices: PricePoint[], currentPrice: string, reporting: boolean) {
  const points: Point[] = reporting
    ? prices.filter((p) => p.reportingPrice !== null).map((p) => [p.t, Number(p.reportingPrice)])
    : prices.map((p) => [p.t, Number(p.price)]);
  const first = points[0]?.[1] ?? 0;
  const last = points[points.length - 1]?.[1] ?? 0;
  return {
    points,
    headerValue: reporting ? last : Number(currentPrice),
    gainAbs: last - first,
    gainPct: first ? (last - first) / first : 0,
  };
}

/** The purchases tab's chart and header: the position's value and invested
 *  lines, both in the account's currency or, when `reporting`, in the
 *  reader's. Days before the first lot or without a rate are dropped. The
 *  header is the chart's own last point. The gain is the value's change minus
 *  what was bought or sold meanwhile: a purchase is money put in, not a gain. */
export function positionChart(prices: PricePoint[], reporting: boolean) {
  const value: Point[] = [];
  const invested: Point[] = [];
  for (const p of prices) {
    const price = reporting ? p.reportingPrice : p.accountPrice;
    const basis = reporting ? p.reportingInvested : p.invested;
    if (price === null || basis === null || p.qty === null) continue;
    value.push([p.t, Number(price) * Number(p.qty)]);
    invested.push([p.t, Number(basis)]);
  }
  const n = value.length - 1;
  const returns = windowReturn(value, invested);
  return {
    value,
    invested,
    headerValue: value[n]?.[1] ?? 0,
    gainAbs: n >= 0 ? value[n][1] - invested[n][1] - (value[0][1] - invested[0][1]) : 0,
    gainPct: returns[returns.length - 1]?.[1] ?? 0,
  };
}
