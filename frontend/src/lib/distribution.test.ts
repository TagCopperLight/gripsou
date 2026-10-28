import { describe, it, expect } from "vitest";
import { distribution, formatShare } from "./distribution";
import type { Account } from "../api/types";

function account(id: string, value: string): Account {
  return {
    id,
    connectionId: "c1",
    name: id,
    color: "#5b9bf0",
    typeKey: "checking",
    value,
    currency: "EUR",
    valueNative: null,
    lastSyncAt: null,
    sourceName: null,
    sourceLogo: null,
    fxMissing: false,
  };
}

const shares = (accounts: Account[]) => distribution(accounts).map((r) => [r.account.id, r.share]);

describe("distribution", () => {
  it("takes shares of what is owned, so an overdraft doesn't push them past 100 %", () => {
    expect(shares([account("checking", "-1000"), account("savings", "3000"), account("pea", "1000")])).toEqual([
      ["savings", 0.75],
      ["pea", 0.25],
      ["checking", null],
    ]);
  });

  it("gives no share at all when nothing is owned", () => {
    expect(shares([account("a", "0"), account("b", "0")])).toEqual([
      ["a", null],
      ["b", null],
    ]);
  });
});

describe("formatShare", () => {
  it("says <0,1 % for a share that would round to 0 %", () => {
    expect(formatShare(0.0002, 1)).toBe("<0,1%");
    expect(formatShare(0.0006, 1)).toBe("0,1%");
    expect(formatShare(0, 1)).toBe("0%");
  });
});
