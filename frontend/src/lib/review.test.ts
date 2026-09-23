import { describe, it, expect } from "vitest";
import {
  applyToSame, clearResolved, initialReview, offerSame, resolve, syncPending, unresolve,
} from "./review";
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
    s = resolve(s, { tx: tx("a"), outcome: "kept", categoryId: "c1", categoryName: "Groceries" });
    s = syncPending(s, [tx("b")]); // the server no longer lists `a`
    expect(s.order).toEqual(["a", "b"]);
    expect(Object.keys(s.resolved)).toEqual(["a"]);
    s = unresolve(s, "a");
    expect(s.resolved).toEqual({});
  });

  it("clearing drops both counts", () => {
    let s = syncPending(initialReview, [tx("a"), tx("b"), tx("c")]);
    s = resolve(s, { tx: tx("a"), outcome: "kept", categoryId: "c1", categoryName: "X" });
    s = resolve(s, { tx: tx("b"), outcome: "corrected", categoryId: "c2", categoryName: "Y" });
    s = clearResolved(s);
    expect(s.order).toEqual(["c"]);
    expect(s.total).toBe(1);
    expect(s.resolved).toEqual({});
  });

  it("records the same-name count only on a line still resolved", () => {
    let s = syncPending(initialReview, [tx("a"), tx("b")]);
    s = resolve(s, { tx: tx("a"), outcome: "kept", categoryId: "c1", categoryName: "X" });
    s = offerSame(s, "a", 3);
    expect(s.resolved.a.sameCount).toBe(3);
    expect(offerSame(s, "b", 2)).toBe(s); // `b` was never resolved (or was undone)
  });

  it("applying to others resolves the pending lines it wrote, and only those", () => {
    let s = syncPending(initialReview, [tx("a"), tx("b"), tx("c"), tx("d")]);
    s = resolve(s, { tx: tx("a"), outcome: "corrected", categoryId: "c2", categoryName: "Y" });
    s = resolve(s, { tx: tx("d"), outcome: "kept", categoryId: "c1", categoryName: "X" });
    // `b` is pending, `d` already resolved on its own, `z` was never in the queue.
    s = applyToSame(s, "a", ["a", "b", "d", "z"], tx);
    expect(s.resolved.a.appliedTo).toBe(3);
    expect(s.resolved.b).toMatchObject({ outcome: "applied", categoryId: "c2", categoryName: "Y" });
    expect(s.resolved.d.outcome).toBe("kept");
    expect(s.resolved.z).toBeUndefined();
    expect(s.resolved.c).toBeUndefined();
    expect(s.order).toEqual(["a", "b", "c", "d"]);
  });
});
