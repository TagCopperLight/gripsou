// Per-asset fake series for the asset modal: unit-price evolution, synthetic
// purchase history, and the position value vs. invested-capital staircase.
// Ported from the mock generators; deterministic per holding.

import { rng, hashStr, walk } from "./random";
import type { Holding } from "./fakeHoldings";

export type Range = {
  key: string;
  label: string;
  points: number;
  spanDays: number;
};

export const RANGES: Range[] = [
  { key: "24h", label: "24h", points: 48, spanDays: 1 },
  { key: "7d", label: "7d", points: 56, spanDays: 7 },
  { key: "1mo", label: "1mo", points: 60, spanDays: 30 },
  { key: "6mo", label: "6mo", points: 80, spanDays: 182 },
  { key: "1y", label: "1y", points: 90, spanDays: 365 },
  { key: "ytd", label: "ytd", points: 70, spanDays: 159 },
  { key: "max", label: "max", points: 120, spanDays: 1095 },
];

const DEFAULT_RANGE = RANGES[2]; // 1mo

// Fraction of the current price the series starts at, per range. "max" depends
// on the holding's own return so the start lines up with its cost basis.
const START_FRAC: Record<string, number> = {
  "24h": 0.99,
  "7d": 0.97,
  "1mo": 0.93,
  "6mo": 0.8,
  "1y": 0.72,
  ytd: 0.78,
};

function rangeByKey(key: string): Range {
  return RANGES.find((r) => r.key === key) ?? DEFAULT_RANGE;
}

// Epoch-ms timestamp of point `i` within a range.
function pointTime(range: Range, i: number): number {
  const spanMs = range.spanDays * 86_400_000;
  return Date.now() - spanMs + (spanMs * i) / (range.points - 1);
}

export type PricePoint = { t: number; price: number; value: number };

export function assetPriceSeries(h: Holding, rangeKey: string): PricePoint[] {
  const range = rangeByKey(rangeKey);
  const endP = h.price;
  const frac = rangeKey === "max" ? 1 / (1 + h.glPct) : (START_FRAC[rangeKey] ?? 0.9);
  const startP = endP * frac;
  const vol = h.kind === "crypto" ? 3.2 : h.kind === "stock" ? 1.8 : 1.0;
  const path = walk(hashStr(h.ticker + rangeKey), range.points, startP, endP, vol);
  return path.map((price, i) => ({
    t: pointTime(range, i),
    price,
    value: price * h.qty,
  }));
}

export type Purchase = {
  daysAgo: number;
  t: number;
  qty: number;
  price: number;
  invested: number;
};

// Synthetic buy lots that sum to the holding's quantity / cost basis.
export function purchaseHistory(h: Holding): Purchase[] {
  if (h.kind === "cash") return [];
  const r = rng(hashStr(h.ticker) + 7);
  const n = 2 + Math.floor(r() * 3);
  const dp = h.kind === "crypto" ? 4 : 2;
  const daySpan = 900;
  let qLeft = h.qty;
  let invLeft = h.invested;
  const lots: Purchase[] = [];
  for (let i = 0; i < n; i++) {
    const isLast = i === n - 1;
    const rough = isLast
      ? qLeft
      : +(qLeft * (0.25 + r() * 0.4)).toFixed(h.kind === "crypto" ? 4 : 0);
    const qty = Math.max(rough, h.kind === "crypto" ? 0.01 : 1);
    const inv = isLast ? invLeft : +(invLeft * (qty / qLeft)).toFixed(2);
    const daysAgo = Math.round(daySpan - (i / n) * daySpan - r() * 60);
    lots.push({
      daysAgo,
      t: Date.now() - daysAgo * 86_400_000,
      qty: +qty.toFixed(dp),
      price: +(inv / qty).toFixed(2),
      invested: +inv.toFixed(2),
    });
    qLeft -= qty;
    invLeft -= inv;
  }
  return lots.sort((a, b) => b.daysAgo - a.daysAgo);
}

export type PositionPoint = { t: number; value: number; invested: number };

// Total value (qty held × price) and invested-capital staircase across a range.
export function positionValueSeries(
  h: Holding,
  rangeKey: string,
): PositionPoint[] {
  const range = rangeByKey(rangeKey);
  const prices = assetPriceSeries(h, rangeKey);
  const purchases = purchaseHistory(h);
  const n = range.points;
  return prices.map((pt, i) => {
    const daysFromNow = range.spanDays - (range.spanDays * i) / (n - 1);
    let qtyHeld = 0;
    let investedAt = 0;
    for (const lot of purchases) {
      if (lot.daysAgo >= daysFromNow - 0.5) {
        qtyHeld += lot.qty;
        investedAt += lot.invested;
      }
    }
    // Purchases predating the range → full position held throughout.
    if (qtyHeld === 0) {
      qtyHeld = h.qty;
      investedAt = h.invested;
    }
    return { t: pt.t, value: pt.price * qtyHeld, invested: investedAt };
  });
}
