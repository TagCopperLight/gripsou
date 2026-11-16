import { useCallback, useState } from "react";

import type { BudgetCategory, Transaction, WriteResult } from "../../api/wire";
import { budgetErrorKey, useBudgetErrorToast, type BudgetErrorKey } from "./budgetErrors";

type Callbacks<R> = { onSuccess: (res: R) => void; onError: (err: unknown) => void };

export type Send<R> = (confirm: boolean, callbacks: Callbacks<R>) => void;

type WriteOptions<R> = {
  /** Ask before sending, for a write the screen already knows breaks this many pairs; the server still refuses unknown ones. */
  askFirst?: number;
  onSend?: () => void;
  onDone?: (res: R) => void;
  onUnwritten?: () => void;
};

/** A paired row breaks its pair unless the new category is neutral, which the server keeps paired. */
export function breaksKnownPair(tx: Transaction, category: BudgetCategory | undefined): boolean {
  return tx.isTransfer && category?.kind !== "neutral";
}

/** A category write that would unlink pairs is refused by the server with a count; `breakPair.confirm` re-sends it confirmed. */
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
