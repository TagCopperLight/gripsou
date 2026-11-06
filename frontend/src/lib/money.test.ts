import { describe, it, expect, afterEach } from "vitest";
import { DEFAULT_PREFS } from "../api/wire";
import { setPrefs } from "./prefs";
import { formatMoney, formatPercent, formatQuantity } from "./money";

describe("formatMoney (prefs-driven)", () => {
  afterEach(() => setPrefs(DEFAULT_PREFS));

  it("keeps each call's separators and currency when the digits are the same", () => {
    expect(formatMoney("1234.5", { fractionDigits: 7, currency: "EUR" })).toBe("1 234,5000000 €");
    expect(formatMoney("9876.25", {
      fractionDigits: 7, currency: "USD", groupSep: ".", decimalSep: ",", currencyPosition: "before",
    })).toBe("$9.876,2500000");
  });

  it("uses default prefs: space groups, comma decimal, € after", () => {
    expect(formatMoney("1234567.89")).toBe("1 234 567,89 €");
  });

  it("honours independent fields: dot group, comma decimal, symbol before", () => {
    setPrefs({
      ...DEFAULT_PREFS,
      numberGroupSep: ".",
      numberDecimalSep: ",",
      currency: "USD",
      currencyPosition: "before",
    });
    expect(formatMoney("1234567.89")).toBe("$1.234.567,89");
  });

  it("places the sign before the symbol", () => {
    setPrefs({ ...DEFAULT_PREFS, currency: "USD", currencyPosition: "before" });
    expect(formatMoney("-1234.5")).toBe("-$1 234,50");
  });

  it("respects the signed option for positives", () => {
    expect(formatMoney("1234.5", { signed: true })).toBe("+1 234,50 €");
  });

  it("uses the prefs currency's symbol by default", () => {
    setPrefs({ ...DEFAULT_PREFS, currency: "USD", currencyPosition: "before" });
    expect(formatMoney("12.5")).toBe("$12,50");
  });

  it("honours a per-call currency override for native-currency figures", () => {
    setPrefs({ ...DEFAULT_PREFS, currency: "EUR", currencyPosition: "after" });
    expect(formatMoney("180.42", { currency: "USD" })).toBe("180,42 $");
  });
});

describe("formatPercent / formatQuantity", () => {
  afterEach(() => setPrefs(DEFAULT_PREFS));

  it("formats a ratio as a percent with the prefs decimal separator", () => {
    // 0.1234 ratio -> 12.34 % ; default percentDecimals = 2.
    expect(formatPercent("0.1234")).toBe("12,34%");
  });

  it("drops trailing zeros on quantities", () => {
    expect(formatQuantity("10")).toBe("10");
    expect(formatQuantity("1234.5")).toBe("1 234,5");
  });

  it("keeps a fractional share's full precision", () => {
    expect(formatQuantity("0.371719")).toBe("0,371719");
    expect(formatQuantity("0.00012345")).toBe("0,00012345");
  });

  it("hides float noise from a locally summed quantity", () => {
    expect(formatQuantity(String(0.1 + 0.2))).toBe("0,3");
  });
});
