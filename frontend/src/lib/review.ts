import type { Transaction } from "../api/types";

export type Resolution = {
  tx: Transaction;            // the row as it was when pending — the guess to restore on Undo
  /** `applied`: swept up by "apply to others" launched from another line. */
  outcome: "kept" | "corrected" | "applied";
  categoryId: string;         // what it now holds — what "apply to others" widens
  categoryName: string;       // what it was kept as / corrected to, already translated
  /** Other rows sharing its description, once the server has said. Nothing
   *  is offered until then, nor when it is 0. */
  sameCount?: number;
  /** Set once "apply to others" ran from this line: how many others it wrote. */
  appliedTo?: number;
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

/** Records how many other rows share a resolved line's description — the
 *  server answers after the write. A line undone meanwhile stays undone. */
export function offerSame(s: ReviewState, id: string, count: number): ReviewState {
  const r = s.resolved[id];
  if (!r) return s;
  return { ...s, resolved: { ...s.resolved, [id]: { ...r, sameCount: count } } };
}

/** Folds in an "apply to others" launched from `anchorId`: every still-pending
 *  line among the rows it wrote resolves in place, so the queue shrinks where
 *  the user can see it rather than lines silently vanishing on the refetch.
 *  `txOf` gives each line's row as first seen — the guess its own Undo puts
 *  back. Written rows outside the queue have no line and are only counted. */
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
