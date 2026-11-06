import { describe, expect, it } from "vitest";
import { positionChart, windowReturn } from "./assetSeries";
import type { PricePoint } from "../api/types";

const pt = (t: number, over: Partial<PricePoint>): PricePoint => ({
  t, price: "10", accountPrice: "10", reportingPrice: "10", qty: "2", invested: "15", reportingInvested: "15", ...over,
});

describe("positionChart", () => {
  it("drops a day before the first lot or without a rate instead of charting zero", () => {
    const chart = positionChart(
      [pt(1, { qty: null, invested: null }), pt(2, { accountPrice: null }), pt(3, {})],
      false,
    );
    expect(chart.value).toEqual([[3, 20]]);
    expect(chart.invested).toEqual([[3, 15]]);
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
