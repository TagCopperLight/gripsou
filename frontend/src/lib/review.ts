import type { Transaction } from "../api/types";

export type Resolution = {
  tx: Transaction;            // the row as it was when pending — the guess to restore on Undo
  outcome: "kept" | "corrected";
  categoryName: string;       // what it was kept as / corrected to, already translated
};

export type ReviewState = {
  /** Ids in first-seen order, pending and resolved together, so a resolved
   *  line stays exactly where it was. */
  order: string[];
  resolved: Record<string, Resolution>;
  /** Pending count on entry, plus rows a live run added; minus cleared lines. */
  total: number;
  cleared: number;
};

export const initialReview: ReviewState = { order: [], resolved: {}, total: 0, cleared: 0 };

/** Folds in the latest server page of pending rows. */
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
