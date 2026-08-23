import { describe, expect, it } from "vitest";
import { positionSeries } from "./assetSeries";
import type { Purchase, PricePoint } from "../api/types";

const prices: PricePoint[] = [
  { t: 100, price: "10" },
  { t: 300, price: "12" },
];

const buy = (t: number, qty: string, amount: string): Purchase => ({
  id: `b${t}`,
  t,
  type: "buy",
  qty,
  price: "10",
  invested: amount,
  manual: true,
});
const sell = (t: number, qty: string, amount: string): Purchase => ({
  id: `s${t}`,
  t,
  type: "sell",
  qty,
  price: "12",
  invested: amount,
  manual: true,
});

describe("positionSeries", () => {
  it("reduces the position on a sale instead of inflating it", () => {
    // Buy 10 before the first point, sell 4 between the two points.
    const pts = positionSeries(prices, [buy(50, "10", "-100"), sell(200, "4", "48")], 6, 60);
    expect(pts[0].value).toBe(10 * 10);
    expect(pts[1].value).toBe(6 * 12);
  });

  it("reports invested as money in, not as a negative amount", () => {
    const pts = positionSeries(prices, [buy(50, "10", "-100")], 10, 100);
    expect(pts[0].invested).toBe(100);
  });

  it("falls back to the current position when every lot postdates the window", () => {
    const pts = positionSeries(prices, [buy(9999, "10", "-100")], 7, 70);
    expect(pts[0].value).toBe(7 * 10);
    expect(pts[0].invested).toBe(70);
  });
});
