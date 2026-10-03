import { describe, it, expect } from "vitest";
import { groupByConnection } from "./accounts";
import type { Account } from "../api/types";

function account(id: string, connectionId: string, value: string): Account {
  return {
    id,
    connectionId,
    name: id,
    color: "#5b9bf0",
    typeKey: "checking",
    typeLabel: "Checking",
    value,
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
