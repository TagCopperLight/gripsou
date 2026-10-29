import { describe, expect, it } from "vitest";
import { positionSeries, windowReturn } from "./assetSeries";
import type { Lot, PricePoint } from "../api/types";

// A same-currency listing: the account price equals the quoted one.
const px = (t: number, price: string): PricePoint => ({ t, price, accountPrice: price, reportingPrice: price });

const prices: PricePoint[] = [
  px(100, "10"),
  px(300, "12"),
];

const buy = (t: number, qty: string, price: string): Lot => ({
  id: String(t), t, side: "buy", qty, price, fee: "0", manual: true,
});
const sell = (t: number, qty: string, price: string): Lot => ({
  id: String(t), t, side: "sell", qty, price, fee: "0", manual: true,
});

describe("positionSeries", () => {
  // Subtracting a sale's PROCEEDS from invested would fold realised profit
  // into the cost basis: buy 10 at 100 then sell 5 at 200 would report
  // invested = 0 while the backend says 500, on the same screen.
  it("a sale removes cost, not proceeds", () => {
    const pts = positionSeries(
      [
        px(100, "150"),
        px(300, "150"),
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
    const pts = positionSeries([px(100, "150")], [buy(50, "4", "100")], 100, 800, 10, 1200);
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

describe("positionSeries on a foreign listing", () => {
  // 10 shares quoted 115 USD, account in EUR, 1 USD = 0.87 EUR: the value line
  // must be in euros like the invested line, or the exchange rate reads as gain.
  it("values the position at the account-currency price", () => {
    const pts = positionSeries(
      [{ t: 100, price: "115", accountPrice: "100.05", reportingPrice: "100.05" }],
      [buy(50, "10", "100")],
      100,
      0,
      10,
      1000,
    );
    expect(pts[0].value).toBeCloseTo(1000.5);
    expect(pts[0].invested).toBe(1000);
  });

  it("drops a day whose rate is missing instead of charting zero", () => {
    const pts = positionSeries(
      [{ t: 100, price: "115", accountPrice: null, reportingPrice: null }, { t: 300, price: "115", accountPrice: "100", reportingPrice: "100" }],
      [],
      0,
      0,
      10,
      1000,
    );
    expect(pts.map((p) => p.t)).toEqual([300]);
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

  it("values the position and its invested line in the reader's currency at each day's rate", () => {
    const prices = [{ t: 1, price: "10", accountPrice: "20", reportingPrice: "10" }]; // 1 account unit = 0.5 reader
    const [pt] = positionSeries(prices, [buy(0, "2", "1")], 15, 4, 2, 34, "reporting");
    expect(pt.value).toBe(20);
    expect(pt.invested).toBe((15 * 2 + 4) * 0.5);
  });
});
