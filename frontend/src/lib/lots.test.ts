import { describe, it, expect } from "vitest";
import { lotCashAmount, validateLot } from "./lots";

describe("validateLot", () => {
  it("accepts a well-formed row", () => {
    expect(validateLot("20", "15.617")).toBeNull();
  });

  it("rejects an unparseable number", () => {
    expect(validateLot("1,234", "10")).toBe("invalidNumber");
  });

  it("rejects a non-positive quantity", () => {
    expect(validateLot("0", "10")).toBe("nonPositiveQuantity");
  });

  it("rejects a negative unit price", () => {
    expect(validateLot("1", "-1")).toBe("negativeUnitPrice");
  });

  it("rejects a fee the server would refuse", () => {
    expect(validateLot("1", "10", "abc")).toBe("invalidNumber");
    expect(validateLot("1", "10", "-1")).toBe("negativeFee");
  });
});

describe("lotCashAmount", () => {
  it("is exact where floats are not", () => {
    // 3 × 0.1 + 0.2 in floats is 0.5000000000000001.
    expect(lotCashAmount("buy", "3", "0.1", "0.2")).toBe("-0.5");
    expect(lotCashAmount("sell", "3", "0.1", "0.2")).toBe("0.1");
  });
});
