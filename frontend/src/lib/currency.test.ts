import { describe, expect, it } from "vitest";
import { CURRENCIES, currencySymbol } from "./currency";

describe("currencySymbol", () => {
  it("maps known codes to symbols", () => {
    expect(currencySymbol("EUR")).toBe("€");
    expect(currencySymbol("USD")).toBe("$");
    expect(currencySymbol("CNY")).toBe("¥");
    expect(currencySymbol("CHF")).toBe("CHF");
  });

  it("falls back to the code itself for anything unknown", () => {
    expect(currencySymbol("SEK")).toBe("SEK");
    expect(currencySymbol("")).toBe("");
  });

  it("offers every listed currency a symbol", () => {
    for (const c of CURRENCIES) expect(currencySymbol(c.code)).toBeTruthy();
  });
});
