import type { Holding, PricePoint, Lot } from "../api/types";

export type PositionPoint = { t: number; value: number; invested: number };

// Value and invested capital at each price point, both in the account's
// currency: `accountPrice`, not `price`, so the value line and the invested
// line (lots are recorded in the account's currency) compare like with like
// on a foreign listing. Points without a rate are dropped.
//
// This file does NOT implement the cost-basis rule and must never start to.
// `meanPrice` and `unexplainedCost` are computed by `lot_basis` in the backend
// and arrive on the holding; all that happens here is a multiplication:
//
//     invested(t) = meanPrice x qty(t) + unexplainedCost
//
// Nothing here reads a lot's cash amount: subtracting a sale's proceeds would
// fold realised profit into the basis, which the backend refuses to do.
export function positionSeries(
  prices: PricePoint[],
  lots: Lot[],
  meanPrice: number,
  unexplainedCost: number,
  fallbackQty: number,
  fallbackInvested: number,
  domain: "account" | "reporting" = "account",
): PositionPoint[] {
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
  // No lots at all (a provider that reports balances only): a flat current
  // position is the best available answer.
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
 *  lines. The header is the chart's own last point, in the chart's currency.
 *  The gain is the value's change minus what was bought or sold meanwhile: a
 *  purchase is money put in, not a gain. */
export function positionChart(
  prices: PricePoint[],
  lots: Lot[],
  holding: Pick<Holding, "meanPrice" | "unexplainedCost" | "qty" | "investedNative">,
  reporting: boolean,
) {
  const pts = positionSeries(
    prices,
    lots,
    Number(holding.meanPrice),
    Number(holding.unexplainedCost),
    Number(holding.qty),
    // Unconverted, not `holding.invested`: the series is built from
    // unconverted prices and lots, so the reporting-currency figure would put
    // two currencies on one line.
    Number(holding.investedNative),
    reporting ? "reporting" : "account",
  );
  const value: Point[] = pts.map((p) => [p.t, p.value]);
  const invested: Point[] = pts.map((p) => [p.t, p.invested]);
  const first = pts[0];
  const end = pts[pts.length - 1];
  const returns = windowReturn(value, invested);
  return {
    value,
    invested,
    headerValue: end?.value ?? 0,
    gainAbs: first && end ? end.value - end.invested - (first.value - first.invested) : 0,
    gainPct: returns[returns.length - 1]?.[1] ?? 0,
  };
}

/** The mean price per share the stats show: the server's fee-inclusive
 *  `lot_basis` figure, the one RecordLotsModal shows too. It is "0" only when
 *  no buy is recorded (a provider that reports a balance but no lots); then
 *  the provider's basis over the quantity, so a real position does not read
 *  as zero. Amount domain (the account's currency). */
export function shownMeanPrice(holding: Pick<Holding, "meanPrice" | "qty" | "investedNative">): string | number {
  if (holding.meanPrice !== "0") return holding.meanPrice;
  const qty = Number(holding.qty);
  return qty === 0 ? 0 : Number(holding.investedNative) / qty;
}
