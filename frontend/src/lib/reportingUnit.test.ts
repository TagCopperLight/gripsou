import { describe, expect, it } from "vitest";
import { reportingOffered } from "./reportingUnit";

describe("reportingOffered", () => {
  const p = (reportingPrice: string | null) => ({ t: 0, price: "1", accountPrice: "1", reportingPrice });
  it("offers the reader's currency only when the chart is in another one and a point converts", () => {
    expect(reportingOffered("USD", "EUR", [p("0.9")])).toBe(true);
    expect(reportingOffered("EUR", "EUR", [p("1")])).toBe(false);
    expect(reportingOffered("USD", "EUR", [p(null)])).toBe(false);
  });
});
