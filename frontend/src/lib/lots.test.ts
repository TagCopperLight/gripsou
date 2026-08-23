import { describe, expect, it } from "vitest";
import { resultingFigures, type LotRow } from "./lots";

const buy = (quantity: number, unitPrice: number): LotRow => ({ type: "buy", quantity, unitPrice });
const sell = (quantity: number, unitPrice: number): LotRow => ({ type: "sell", quantity, unitPrice });

describe("resultingFigures", () => {
  // The spec's §4.1 worked example, the one the modal's panel must reproduce.
  it("uses the lifetime mean buy price", () => {
    const f = resultingFigures([buy(10, 20), buy(10, 30), sell(5, 35)], 40);
    expect(f.meanPrice).toBeCloseTo(25, 10);
    expect(f.netQty).toBeCloseTo(15, 10);
    expect(f.invested).toBeCloseTo(375, 10);
    expect(f.realised).toBeCloseTo(50, 10);
    expect(f.unrealised).toBeCloseTo(15 * 40 - 375, 10);
  });

  // μ is order-independent by construction — that is the whole reason it was
  // chosen over a running average, and deleting a middle row must not cascade.
  it("is independent of row order", () => {
    const a = resultingFigures([buy(10, 20), sell(5, 35), buy(10, 30)], 40);
    const b = resultingFigures([buy(10, 30), buy(10, 20), sell(5, 35)], 40);
    expect(a).toEqual(b);
  });

  it("returns zeros rather than NaN when there are no buys", () => {
    const f = resultingFigures([sell(5, 35)], 40);
    expect(f.meanPrice).toBe(0);
    expect(f.invested).toBe(0);
    expect(f.realised).toBe(0);
    expect(f.unrealised).toBe(0);
    // The quantity is still reported honestly — the bar needs it to go red.
    expect(f.netQty).toBeCloseTo(-5, 10);
  });

  it("returns zeros for an empty table", () => {
    expect(resultingFigures([], 40)).toEqual({
      meanPrice: 0,
      netQty: 0,
      invested: 0,
      realised: 0,
      unrealised: 0,
    });
  });
});
