import { describe, it, expect } from "vitest";
import { trackedIndex } from "./indices";

describe("trackedIndex", () => {
  it.each([
    ["XTRACKERS MSCI WORLD UCITS ETF 1C", "MSCI World"],
    ["HSBC MSCI WORLD UCITS ETF USD (DIST)", "MSCI World"],
    ["LYXOR NASDAQ-100 UCITS ETF ACC", "Nasdaq-100"],
    ["Invesco EQQQ Nasdaq 100 UCITS ETF", "Nasdaq-100"],
    ["VANGUARD S&P 500 UCITS ETF USD ACCUMULATING", "S&P 500"],
    ["SPDR S&P500 UCITS ETF", "S&P 500"],
    ["ISHARES STOXX EUROPE 600 UCITS ETF (DE) / DIST", "Stoxx Europe 600"],
    ["Xtrackers Euro Stoxx 50 UCITS ETF 1C", "Euro Stoxx 50"],
    ["Lyxor CAC 40 (DR) UCITS ETF Acc", "CAC 40"],
    ["Example Emerging ESG Screened MSCI Emerging Markets", "MSCI Emerging Markets"],
    ["iShares MSCI ACWI UCITS ETF", "MSCI ACWI"],
    ["SPDR MSCI All Country World UCITS ETF", "MSCI ACWI"],
  ])("finds the index in %s", (name, index) => {
    expect(trackedIndex(name)).toBe(index);
  });

  it("doesn't mistake a narrower MSCI World index for the broad one", () => {
    expect(trackedIndex("iShares MSCI World Small Cap UCITS ETF")).toBeNull();
  });

  it("is null when the name names no known index", () => {
    expect(trackedIndex("Example Thematic Robotics ETF")).toBeNull();
  });
});
