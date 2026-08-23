import { describe, it, expect, afterEach } from "vitest";
import { DEFAULT_PREFS, setPrefs } from "./prefs";
import { formatMoney, formatPercent, formatQuantity } from "./money";
import { normaliseDecimal, validateRow } from "./money";

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

  it("drops trailing zeros on quantities (max 2)", () => {
    expect(formatQuantity("10")).toBe("10");
    expect(formatQuantity("1234.5")).toBe("1 234,5");
  });
});

describe("normaliseDecimal", () => {
  it("reads a comma as the decimal separator under fr", () => {
    expect(normaliseDecimal("16,03", "fr")).toBe("16.03");
  });

  it("leaves a comma alone under en, so DECIMAL_RE rejects it loudly", () => {
    expect(normaliseDecimal("1,234", "en")).toBe("1,234");
  });

  it("refuses to guess when both separators are present", () => {
    expect(normaliseDecimal("1,234.56", "fr")).toBe("1,234.56");
  });

  it("refuses to guess with more than one comma", () => {
    expect(normaliseDecimal("1,234,567", "fr")).toBe("1,234,567");
  });
});

describe("validateRow", () => {
  it("accepts a well-formed row", () => {
    expect(validateRow("20", "16.029")).toBeNull();
  });

  it("rejects an unparseable number", () => {
    expect(validateRow("1,234", "10")).toBe("invalidNumber");
  });

  it("rejects a non-positive quantity", () => {
    expect(validateRow("0", "10")).toBe("nonPositiveQuantity");
  });

  it("rejects a negative unit price", () => {
    expect(validateRow("1", "-1")).toBe("negativeUnitPrice");
  });
});
