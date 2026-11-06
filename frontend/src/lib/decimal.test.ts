import { describe, it, expect } from "vitest";
import { normaliseDecimal, subtractDecimals, sumDecimals } from "./decimal";

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

describe("sumDecimals", () => {
  it("sums decimal strings exactly, without a float artifact", () => {
    // Number('-12.40')+Number('-9.08')+Number('-0.10') is -21.580000000000002.
    expect(sumDecimals(["-12.40", "-9.08", "-0.10"])).toBe("-21.58");
  });

  it("returns 0 for an empty list", () => {
    expect(sumDecimals([])).toBe("0");
  });

  it("keeps the widest fraction length across mismatched inputs", () => {
    expect(sumDecimals(["1.5", "2.25"])).toBe("3.75");
  });

  it("handles negatives crossing zero", () => {
    expect(sumDecimals(["-1.00", "0.25"])).toBe("-0.75");
  });

  it("renders an exact-zero result unsigned, at the widest fraction length", () => {
    expect(sumDecimals(["-0.5", "0.5"])).toBe("0.0");
  });

  it("sums whole numbers with no decimal point", () => {
    expect(sumDecimals(["5", "3", "-2"])).toBe("6");
  });
});

describe("subtractDecimals", () => {
  it("subtracts exactly where floats would not", () => {
    // 0.3 - 0.1 in floats is 0.19999999999999998.
    expect(subtractDecimals("0.3", "0.1")).toBe("0.2");
    expect(subtractDecimals("1940.00", "2010.00")).toBe("-70.00");
    expect(subtractDecimals("5", "-2.5")).toBe("7.5");
  });
});
