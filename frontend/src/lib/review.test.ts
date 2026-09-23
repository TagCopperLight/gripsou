import { describe, it, expect } from "vitest";
import { clearResolved, initialReview, resolve, syncPending, unresolve } from "./review";
import type { Transaction } from "../api/types";

const tx = (id: string) => ({ id }) as Transaction;

describe("review queue state", () => {
  it("counts rows the first time it sees them", () => {
    let s = syncPending(initialReview, [tx("a"), tx("b")]);
    s = syncPending(s, [tx("a"), tx("b"), tx("c")]);
    expect(s.order).toEqual(["a", "b", "c"]);
    expect(s.total).toBe(3);
  });

  it("keeps a resolved line in place, and Undo brings it back", () => {
    let s = syncPending(initialReview, [tx("a"), tx("b")]);
    s = resolve(s, { tx: tx("a"), outcome: "kept", categoryName: "Groceries" });
    s = syncPending(s, [tx("b")]); // the server no longer lists `a`
    expect(s.order).toEqual(["a", "b"]);
    expect(Object.keys(s.resolved)).toEqual(["a"]);
    s = unresolve(s, "a");
    expect(s.resolved).toEqual({});
  });

  it("clearing drops both counts", () => {
    let s = syncPending(initialReview, [tx("a"), tx("b"), tx("c")]);
    s = resolve(s, { tx: tx("a"), outcome: "kept", categoryName: "X" });
    s = resolve(s, { tx: tx("b"), outcome: "corrected", categoryName: "Y" });
    s = clearResolved(s);
    expect(s.order).toEqual(["c"]);
    expect(s.total).toBe(1);
    expect(s.resolved).toEqual({});
  });
});
