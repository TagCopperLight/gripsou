import { describe, it, expect } from "vitest";
import { aggregateCash } from "./holdings";
import type { Holding } from "../api/types";

function cash(
  id: string,
  account: string,
  value: string,
  accountType = "checking",
  accountTypeLabel = "Checking",
): Holding {
  return {
    id,
    ticker: "EUR",
    name: "Euro",
    kind: "cash",
    logo: "#888",
    accountId: account,
    accountName: account,
    accountColor: "#888",
    accountType,
    accountTypeLabel,
    qty: value,
    price: "1",
    currency: "EUR",
    priceCurrency: "EUR",
    accountCurrency: "EUR",
    invested: value,
    investedNative: value,
    value,
    gl: "0",
    glPct: "0",
    fxMissing: false,
    spark: null,
    composition: null,
    unexplainedQty: "0",
  };
}

function equity(id: string, value: string): Holding {
  return {
    id,
    ticker: "AAPL",
    name: "Apple Inc.",
    kind: "equity",
    logo: "#555",
    accountId: "a",
    accountName: "Trade Republic",
    accountColor: "#555",
    accountType: "brokerage",
    accountTypeLabel: "Brokerage",
    qty: "1",
    price: value,
    currency: "EUR",
    priceCurrency: "EUR",
    accountCurrency: "EUR",
    invested: value,
    investedNative: value,
    value,
    gl: "0",
    glPct: "0",
    fxMissing: false,
    spark: ["1", "2"],
    composition: null,
    unexplainedQty: "0",
  };
}

describe("aggregateCash", () => {
  it("merges same-currency cash across accounts into one summed row", () => {
    const result = aggregateCash(
      [cash("c1", "Checking", "100"), cash("c2", "PEA", "200"), equity("e1", "500")],
      "Multiple accounts",
    );

    const cashRows = result.filter((h) => h.kind === "cash");
    expect(cashRows).toHaveLength(1);
    expect(cashRows[0].value).toBe("300");
    expect(cashRows[0].qty).toBe("300");
    expect(cashRows[0].accountName).toBe("Multiple accounts");

    // Non-cash holdings pass through untouched.
    expect(result.filter((h) => h.kind === "equity")).toHaveLength(1);
  });

  it("keeps a lone cash holding as its original (per-account) row", () => {
    const result = aggregateCash([cash("c1", "Checking", "100")], "Multiple accounts");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("c1");
    expect(result[0].accountName).toBe("Checking");
  });

  it("groups by currency, summing each separately", () => {
    const usd: Holding = { ...cash("c3", "USD acct", "50"), ticker: "USD", name: "Dollar" };
    const result = aggregateCash(
      [cash("c1", "A", "100"), cash("c2", "B", "200"), usd],
      "Multiple accounts",
    );

    const cashRows = result.filter((h) => h.kind === "cash");
    expect(cashRows).toHaveLength(2); // EUR merged + USD lone
    expect(cashRows.find((h) => h.ticker === "EUR")!.value).toBe("300");
    expect(cashRows.find((h) => h.ticker === "USD")!.value).toBe("50");
  });

  it("marks the merged row \"multiple\" when account types differ", () => {
    const result = aggregateCash(
      [
        cash("c1", "Checking", "100", "checking", "Checking"),
        cash("c2", "PEA", "200", "pea", "PEA"),
      ],
      "Multiple accounts",
    );

    const cashRows = result.filter((h) => h.kind === "cash");
    expect(cashRows).toHaveLength(1);
    expect(cashRows[0].accountType).toBe("multiple");
    expect(cashRows[0].accountTypeLabel).toBe("Multiple");
  });

  it("keeps the shared account type when merged rows agree", () => {
    const result = aggregateCash(
      [
        cash("c1", "Checking A", "100", "savings", "Savings"),
        cash("c2", "Checking B", "200", "savings", "Savings"),
      ],
      "Multiple accounts",
    );

    const cashRows = result.filter((h) => h.kind === "cash");
    expect(cashRows).toHaveLength(1);
    expect(cashRows[0].accountType).toBe("savings");
    expect(cashRows[0].accountTypeLabel).toBe("Savings");
  });

  it("keeps the fx warning when merging cash rows", () => {
    const merged = aggregateCash(
      [
        { ...cash("c1", "A", "10"), fxMissing: true },
        { ...cash("c2", "B", "20") },
      ],
      "Multiple",
    );
    expect(merged[0].fxMissing).toBe(true);
  });
});
