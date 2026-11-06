import { useCallback, useState } from "react";

import type { BudgetCategory, Transaction, WriteResult } from "../../api/wire";
import { budgetErrorKey, useBudgetErrorToast, type BudgetErrorKey } from "./budgetErrors";

type Callbacks<R> = { onSuccess: (res: R) => void; onError: (err: unknown) => void };

/** Sends the write once, with `confirm` saying whether the user agreed to
 *  unlink the pairs it breaks. */
export type Send<R> = (confirm: boolean, callbacks: Callbacks<R>) => void;

type WriteOptions<R> = {
  /** Ask before anything is sent, for a write the screen already knows
   *  breaks this many pairs: its row never flips and back while the server
   *  refuses. The server still refuses on its own for one it doesn't know. */
  askFirst?: number;
  /** Before each attempt (the confirmed one included). */
  onSend?: () => void;
  /** Applied. */
  onDone?: (res: R) => void;
  /** Refused pending confirmation, or failed: nothing was written. */
  onUnwritten?: () => void;
};

/** A row the list shows as half of a pair breaks it, unless the category is
 *  neutral: that counts toward nothing, as the pair does, so the server keeps
 *  the pair. */
export function breaksKnownPair(tx: Transaction, category: BudgetCategory | undefined): boolean {
  return tx.isTransfer && category?.kind !== "neutral";
}

/** The protocol every budget write of a screen speaks. A category write that
 *  would unlink internal-transfer pairs is refused by the server, which
 *  writes nothing and reports how many; the user is asked (`breakPair`), and
 *  `breakPair.confirm` re-sends the identical write confirmed. A failed write
 *  shows in the corner until the next one starts. */
export function useBudgetWrites() {
  const [failure, setFailure] = useState<BudgetErrorKey | null>(null);
  const [breakPair, setBreakPair] = useState<{ count: number; confirm: () => void } | null>(null);
  useBudgetErrorToast(failure, "budget.transactions.errors");

  const start = useCallback(() => setFailure(null), []);
  const fail = useCallback((err: unknown) => setFailure(budgetErrorKey(err)), []);
  const dismissBreakPair = useCallback(() => setBreakPair(null), []);

  const write = <R extends Pick<WriteResult, "pendingPairBreaks">>(send: Send<R>, opts: WriteOptions<R> = {}) => {
    const attempt = (confirm: boolean) => {
      opts.onSend?.();
      send(confirm, {
        onSuccess: (res) => {
          if (res?.pendingPairBreaks) {
            opts.onUnwritten?.();
            setBreakPair({ count: res.pendingPairBreaks, confirm: () => attempt(true) });
            return;
          }
          setBreakPair(null);
          opts.onDone?.(res);
        },
        onError: (err) => {
          opts.onUnwritten?.();
          setBreakPair(null);
          fail(err);
        },
      });
    };
    setFailure(null);
    if (opts.askFirst) setBreakPair({ count: opts.askFirst, confirm: () => attempt(true) });
    else attempt(false);
  };

  return { write, start, fail, breakPair, dismissBreakPair };
}
