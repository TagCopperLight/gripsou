import { describe, expect, it } from "vitest";
import { positionSeries, windowReturn } from "./assetSeries";
import type { Lot, PricePoint } from "../api/types";

const prices: PricePoint[] = [
  { t: 100, price: "10" },
  { t: 300, price: "12" },
];

const buy = (t: number, qty: string, price: string): Lot => ({
  id: String(t), t, side: "buy", qty, price, fee: "0", manual: true,
});
const sell = (t: number, qty: string, price: string): Lot => ({
  id: String(t), t, side: "sell", qty, price, fee: "0", manual: true,
});

describe("positionSeries", () => {
  // AUDIT.md D-1's headline case. The old implementation subtracted a sale's
  // PROCEEDS from invested, folding realised profit into the cost basis: buy 10
  // at 100 then sell 5 at 200 reported invested = 0 while the backend said 500,
  // on the same screen.
  it("a sale removes cost, not proceeds", () => {
    const pts = positionSeries(
      [
        { t: 100, price: "150" },
        { t: 300, price: "150" },
      ],
      [buy(50, "10", "100"), sell(200, "5", "200")],
      100,
      0,
      5,
      500,
    );
    expect(pts[0].invested).toBe(1000);
    expect(pts[1].invested).toBe(500);
  });

  it("carries the unexplained basis on every point", () => {
    const pts = positionSeries([{ t: 100, price: "150" }], [buy(50, "4", "100")], 100, 800, 10, 1200);
    expect(pts[0].invested).toBe(1200);
  });

  it("reduces the position on a sale instead of inflating it", () => {
    // Buy 10 before the first point, sell 4 between the two points.
    const pts = positionSeries(prices, [buy(50, "10", "100"), sell(200, "4", "12")], 10, 0, 6, 60);
    expect(pts[0].value).toBe(10 * 10);
    expect(pts[1].value).toBe(6 * 12);
  });

  it("starts at the first purchase instead of charting a position before it", () => {
    // Buy between the two points: the earlier point is not part of the series.
    const pts = positionSeries(prices, [buy(200, "10", "10")], 10, 0, 10, 100);
    expect(pts).toHaveLength(1);
    expect(pts[0].t).toBe(300);
    expect(pts[0].value).toBe(10 * 12);
  });

  it("charts a sold-out position as zero, not as the current holding", () => {
    const pts = positionSeries(prices, [buy(50, "10", "10"), sell(200, "10", "12")], 10, 0, 0, 0);
    expect(pts[1].value).toBe(0);
  });

  it("keeps the flat current position when no lots are known", () => {
    const pts = positionSeries(prices, [], 10, 0, 7, 70);
    expect(pts[0].value).toBe(7 * 10);
    expect(pts[0].invested).toBe(70);
  });
});

describe("windowReturn", () => {
  it("starts at 0 and reads the window's gain, not lifetime gain", () => {
    // Already +100% at window start (100 value on 50 invested), then +10 value.
    const r = windowReturn([[1, 100], [2, 110]], [[1, 50], [2, 50]]);
    expect(r[0][1]).toBe(0);
    expect(r[1][1]).toBeCloseTo(0.1, 10);
  });

  it("does not count a mid-window deposit as gain", () => {
    const r = windowReturn([[1, 100], [2, 200]], [[1, 50], [2, 150]]);
    expect(r[1][1]).toBe(0);
  });
});
