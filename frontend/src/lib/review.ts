import type { Transaction } from "../api/wire";

export type Resolution = {
  tx: Transaction;
  outcome: "kept" | "corrected" | "applied";
  categoryId: string;
  categoryName: string;
  /** Nothing is offered until the server has said, nor when it is 0. */
  sameCount?: number;
  appliedTo?: number;
};

export type ReviewState = {
  order: string[];
  resolved: Record<string, Resolution>;
  total: number;
  cleared: number;
};

export const initialReview: ReviewState = { order: [], resolved: {}, total: 0, cleared: 0 };

export function syncPending(s: ReviewState, pending: Transaction[]): ReviewState {
  const known = new Set(s.order);
  const fresh = pending.map((t) => t.id).filter((id) => !known.has(id));
  if (fresh.length === 0) return s;
  return { ...s, order: [...s.order, ...fresh], total: s.total + fresh.length };
}

export function resolve(s: ReviewState, r: Resolution): ReviewState {
  return { ...s, resolved: { ...s.resolved, [r.tx.id]: r } };
}

export function unresolve(s: ReviewState, id: string): ReviewState {
  const resolved = { ...s.resolved };
  delete resolved[id];
  return { ...s, resolved };
}

export function clearResolved(s: ReviewState): ReviewState {
  const gone = new Set(Object.keys(s.resolved));
  return {
    order: s.order.filter((id) => !gone.has(id)),
    resolved: {},
    total: s.total - gone.size,
    cleared: s.cleared + gone.size,
  };
}

export function offerSame(s: ReviewState, id: string, count: number): ReviewState {
  const r = s.resolved[id];
  if (!r) return s;
  return { ...s, resolved: { ...s.resolved, [id]: { ...r, sameCount: count } } };
}

export function applyToSame(
  s: ReviewState,
  anchorId: string,
  written: string[],
  txOf: (id: string) => Transaction | undefined,
): ReviewState {
  const anchor = s.resolved[anchorId];
  if (!anchor) return s;
  const others = written.filter((id) => id !== anchorId);
  const resolved = { ...s.resolved, [anchorId]: { ...anchor, appliedTo: others.length } };
  const inQueue = new Set(s.order);
  for (const id of others) {
    const tx = txOf(id);
    if (!inQueue.has(id) || resolved[id] || !tx) continue;
    resolved[id] = {
      tx,
      outcome: "applied",
      categoryId: anchor.categoryId,
      categoryName: anchor.categoryName,
    };
  }
  return { ...s, resolved };
}
