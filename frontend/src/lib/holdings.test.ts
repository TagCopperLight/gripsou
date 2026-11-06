import { describe, it, expect } from "vitest";
import { holdingLines } from "./holdings";
import type { Holding } from "../api/wire";

function cash(
  id: string,
  account: string,
  value: string,
  accountType = "checking",
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
    qty: value,
    price: "1",
    currency: "EUR",
    priceCurrency: "EUR",
    accountCurrency: "EUR",
    invested: value,
    investedNative: value,
    value,
    valueNative: value,
    gl: "0",
    glPct: "0",
    fxMissing: false,
    spark: null,
    composition: null,
    unexplainedQty: "0",
    meanPrice: "0",
  };
}

describe("holdingLines", () => {
  const cashLines = (holdings: Holding[]) => holdingLines(holdings).filter((l) => l.holdings[0].kind === "cash");

  it("sums exactly, without a float artifact", () => {
    // 0.1 + 0.2 in floats is 0.30000000000000004.
    expect(cashLines([cash("c1", "A", "0.1"), cash("c2", "B", "0.2")])[0].value).toBe("0.3");
  });

  it("keeps a lone cash holding as its own (per-account) line", () => {
    const result = holdingLines([cash("c1", "Checking", "100")]);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("c1");
    expect(result[0].account?.name).toBe("Checking");
  });

  it("groups by currency, summing each separately", () => {
    const usd: Holding = { ...cash("c3", "USD acct", "50"), ticker: "USD", name: "Dollar" };
    const lines = cashLines([cash("c1", "A", "100"), cash("c2", "B", "200"), usd]);

    expect(lines).toHaveLength(2); // EUR merged + USD lone
    expect(lines.find((l) => l.holdings[0].ticker === "EUR")!.value).toBe("300");
    expect(lines.find((l) => l.holdings[0].ticker === "USD")!.value).toBe("50");
  });

  it("claims no account type when the merged accounts' types differ", () => {
    const lines = cashLines([cash("c1", "Checking", "100", "checking"), cash("c2", "PEA", "200", "pea")]);
    expect(lines).toHaveLength(1);
    expect(lines[0].accountType).toBeNull();
  });

  it("keeps the shared account type when merged accounts agree", () => {
    const lines = cashLines([cash("c1", "Checking A", "100", "savings"), cash("c2", "Checking B", "200", "savings")]);
    expect(lines).toHaveLength(1);
    expect(lines[0].accountType).toBe("savings");
  });

  it("keeps the missing rate and the own-currency total when merging cash", () => {
    const [merged] = holdingLines([{ ...cash("c1", "A", "10"), fxMissing: true, value: "0" }, cash("c2", "B", "20")]);
    expect(merged.fxMissing).toBe(true);
    expect(merged.valueNative).toBe("30");
  });
});
