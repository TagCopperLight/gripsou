import { describe, it, expect, afterEach } from "vitest";
import { DEFAULT_PREFS, setPrefs } from "./prefs";
import { formatMoney, formatPercent, formatQuantity } from "./money";

describe("formatMoney (prefs-driven)", () => {
  afterEach(() => setPrefs(DEFAULT_PREFS));

  it("uses default prefs: space groups, comma decimal, € after", () => {
    expect(formatMoney("1234567.89")).toBe("1 234 567,89 €");
  });

  it("honours independent fields: dot group, comma decimal, symbol before", () => {
    setPrefs({
      ...DEFAULT_PREFS,
      numberGroupSep: ".",
      numberDecimalSep: ",",
      currencySymbol: "$",
      currencyPosition: "before",
    });
    expect(formatMoney("1234567.89")).toBe("$1.234.567,89");
  });

  it("places the sign before the symbol", () => {
    setPrefs({ ...DEFAULT_PREFS, currencySymbol: "$", currencyPosition: "before" });
    expect(formatMoney("-1234.5")).toBe("-$1 234,50");
  });

  it("respects the signed option for positives", () => {
    expect(formatMoney("1234.5", { signed: true })).toBe("+1 234,50 €");
  });
});

describe("formatPercent / formatQuantity", () => {
  afterEach(() => setPrefs(DEFAULT_PREFS));

  it("formats a ratio as a percent with the prefs decimal separator", () => {
    // 0.1234 ratio -> 12.34 % ; default percentDecimals = 2.
    expect(formatPercent("0.1234")).toBe("12,34%");
  });

  it("drops trailing zeros on quantities (max 2)", () => {
    expect(formatQuantity("10")).toBe("10");
    expect(formatQuantity("1234.5")).toBe("1 234,5");
  });
});
