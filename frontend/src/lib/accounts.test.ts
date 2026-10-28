import { describe, it, expect } from "vitest";
import { groupByConnection, legendAccounts } from "./accounts";
import type { Account } from "../api/types";

function account(id: string, connectionId: string, value: string): Account {
  return {
    id,
    connectionId,
    name: id,
    color: "#5b9bf0",
    typeKey: "checking",
    value,
    currency: "EUR",
    valueNative: null,
    lastSyncAt: null,
    sourceName: `Bank ${connectionId}`,
    sourceLogo: null,
    fxMissing: false,
  };
}

describe("groupByConnection", () => {
  it("groups by connection, biggest subtotal first, keeping account order", () => {
    const groups = groupByConnection([
      account("a", "c1", "500"),
      account("b", "c2", "400"),
      account("c", "c2", "300"),
      account("d", "c1", "10"),
    ]);
    expect(groups.map((g) => g.connectionId)).toEqual(["c2", "c1"]);
    expect(groups[0].total).toBe(700);
    expect(groups[0].accounts.map((a) => a.id)).toEqual(["b", "c"]);
    expect(groups[1].accounts.map((a) => a.id)).toEqual(["a", "d"]);
    expect(groups[1].sourceName).toBe("Bank c1");
  });

  it("keeps two connections to the same bank apart", () => {
    const a = account("a", "c1", "1");
    const b = { ...account("b", "c2", "1"), sourceName: a.sourceName };
    expect(groupByConnection([a, b])).toHaveLength(2);
  });
});

describe("legendAccounts", () => {
  const series = (n: number) => ({
    accounts: Array.from({ length: n }, (_, i) => ({ id: `a${i}`, name: `A${i}`, color: "#fff" })),
    // A value that grows with the index: the last accounts are the biggest.
    points: [{ t: 0, values: Object.fromEntries(Array.from({ length: n }, (_, i) => [`a${i}`, String((i + 1) * 10)])) }],
  });

  it("names the five biggest at the range's end and counts the rest", () => {
    const { shown, others } = legendAccounts(series(8));
    expect(shown.map((a) => a.id)).toEqual(["a7", "a6", "a5", "a4", "a3"]);
    expect(others).toEqual(["A2", "A1", "A0"]);
  });

  it("names a sixth rather than writing '+1 other'", () => {
    expect(legendAccounts(series(6))).toMatchObject({ others: [] });
    expect(legendAccounts(series(6)).shown.map((a) => a.id)).toEqual(["a5", "a4", "a3", "a2", "a1", "a0"]);
  });

  it("leaves out an account at zero over the whole range, not one emptied during it", () => {
    const s = {
      accounts: ["kept", "emptied", "zero"].map((id) => ({ id, name: id, color: "#fff" })),
      points: [
        { t: 0, values: { kept: "5", emptied: "40", zero: "0" } },
        { t: 1, values: { kept: "5", emptied: "0", zero: "0" } },
      ],
    };
    expect(legendAccounts(s).shown.map((a) => a.id)).toEqual(["kept", "emptied"]);
  });
});
