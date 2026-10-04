import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { PartyPopper } from "lucide-react";

import { Surface } from "../../components/Surface";
import { Button } from "../../components/Button";
import { CategoryChooser } from "../../components/budget/CategoryChooser";
import { ReviewLine } from "../../components/budget/review/ReviewLine";
import { ResolvedLine } from "../../components/budget/review/ResolvedLine";
import { ReviewProgress } from "../../components/budget/review/ReviewProgress";
import { BreakPairModal } from "../../components/budget/BreakPairModal";
import { useTransactions } from "../../api/hooks";
import {
  useAcceptReview, useAiStatus, useApplyToDescription, useBudgetCategories, usePatchTransaction,
  useUndoReview,
} from "../../api/budget";
import { useAuth } from "../../auth/context";
import { budgetErrorKey, categoryLabel, categoryOfTransaction } from "../../lib/budget";
import {
  applyToSame, clearResolved, initialReview, offerSame, resolve, syncPending, unresolve,
  type Resolution, type ReviewState,
} from "../../lib/review";
import type { Transaction, TransactionFilterQuery } from "../../api/types";

/** The queue is all-time and includes internal transfers, which a guess can
 *  land in — the list hides them by default. */
const QUEUE: TransactionFilterQuery = { needsReview: true, includeTransfers: true };

export function ReviewMode() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { prefs } = useAuth();
  const status = useAiStatus().data;
  const list = useTransactions(QUEUE);
  const categories = useBudgetCategories().data ?? [];
  const accept = useAcceptReview();
  const undo = useUndoReview();
  const patch = usePatchTransaction();
  const applyToDescription = useApplyToDescription();

  const pending: Transaction[] = useMemo(() => list.data?.pages.flat() ?? [], [list.data]);
  const [state, setState] = useState<ReviewState>(initialReview);
  const [snapshots, setSnapshots] = useState<Record<string, Transaction>>({});
  const [correcting, setCorrecting] = useState<{ tx: Transaction; anchor: HTMLElement } | null>(null);
  const [breakPair, setBreakPair] = useState<{ count: number; run: () => void } | null>(null);
  // A failed write puts its line back the way it was and says so here, as
  // the transactions list does.
  const [writeErrorKey, setWriteErrorKey] = useState<string | null>(null);

  // Remember every row as first seen: a resolved row leaves the server list,
  // but its line — and the guess Undo restores — must stay. Adjusted during
  // render when the server page changes (React's "adjust state on prop
  // change" pattern), not in an effect.
  const pendingKey = pending.map((p) => p.id).join(",");
  const [seenKey, setSeenKey] = useState("");
  if (pendingKey !== seenKey) {
    setSeenKey(pendingKey);
    setSnapshots((s) => {
      const next = { ...s };
      for (const tx of pending) if (!next[tx.id]) next[tx.id] = tx;
      return next;
    });
    setState((s) => syncPending(s, pending));
  }

  const busy = accept.isPending || undo.isPending || patch.isPending || applyToDescription.isPending;
  const resolvedCount = Object.keys(state.resolved).length;
  const pendingIds = new Set(pending.map((p) => p.id));
  const lines = state.order.filter((id) => state.resolved[id] || pendingIds.has(id));
  // The list is paged, so `state.total` only knows the rows loaded so far. The
  // server's queue size covers the rest: whatever it counts beyond the loaded
  // rows is still to come. Both refetch together after every write.
  const unloaded = Math.max(0, (status?.reviewCount ?? 0) - pending.length);
  const total = state.total + unloaded;

  const onWriteError = (err: unknown) => setWriteErrorKey(budgetErrorKey(err));

  /** Takes back a line resolved ahead of its write, unless something has
   *  replaced that resolution since (an Undo, say). */
  const rollBack = (r: Resolution) =>
    setState((s) => (s.resolved[r.tx.id] === r ? unresolve(s, r.tx.id) : s));

  const onAccept = (tx: Transaction) => {
    const cat = categoryOfTransaction(tx);
    const categoryId = tx.categoryId;
    if (!categoryId) return;
    const r: Resolution = { tx, outcome: "kept", categoryId, categoryName: cat ? categoryLabel(t, cat) : "" };
    setWriteErrorKey(null);
    setState((s) => resolve(s, r));
    accept.mutate(tx.id, {
      onSuccess: (res) => setState((s) => offerSame(s, tx.id, res.sameDescriptionCount)),
      onError: (err) => {
        rollBack(r);
        onWriteError(err);
      },
    });
  };

  /** Recategorising half of a transfer pair dissolves the pair, so the server
   *  refuses an unconfirmed write to one and says so; we then ask, and re-send
   *  with the flag — the same rule as every other write. */
  const correct = (tx: Transaction, categoryId: string, confirmBreakPairs: boolean) => {
    const cat = categories.find((c) => c.id === categoryId);
    const r: Resolution = {
      tx, outcome: "corrected", categoryId, categoryName: cat ? categoryLabel(t, cat) : "",
    };
    setWriteErrorKey(null);
    setState((s) => resolve(s, r));
    patch.mutate(
      {
        id: tx.id,
        body: { categoryId, offerScope: "review", ...(confirmBreakPairs ? { confirmBreakPairs: true } : {}) },
      },
      {
        onSuccess: (res) => {
          if (res.pendingPairBreaks) {
            // Refused, nothing written: the line goes back to pending.
            rollBack(r);
            setBreakPair({ count: res.pendingPairBreaks, run: () => correct(tx, categoryId, true) });
            return;
          }
          setBreakPair(null);
          setState((s) => offerSame(s, tx.id, res.sameDescriptionCount));
        },
        onError: (err) => {
          rollBack(r);
          setBreakPair(null);
          onWriteError(err);
        },
      },
    );
  };

  const onPick = (id: string | null) => {
    if (!correcting || !id) return;
    correct(correcting.tx, id, false);
    setCorrecting(null);
  };

  /** Widens a resolved line's category to the rows sharing its description
   *  that are still in review — never one the user already settled. Same pair
   *  rule as `correct`. Nothing on screen changes until it lands. */
  const runApplyToOthers = (anchorId: string, categoryId: string, confirmBreakPairs: boolean) => {
    setWriteErrorKey(null);
    applyToDescription.mutate(
      { id: anchorId, categoryId, scope: "review", confirmBreakPairs },
      {
        onSuccess: (res) => {
          if (res.pendingPairBreaks) {
            setBreakPair({ count: res.pendingPairBreaks, run: () => runApplyToOthers(anchorId, categoryId, true) });
            return;
          }
          setBreakPair(null);
          setState((s) => applyToSame(s, anchorId, res.ids ?? [], (id) => snapshots[id]));
        },
        onError: (err) => {
          setBreakPair(null);
          onWriteError(err);
        },
      },
    );
  };

  const onUndo = (id: string) => {
    const r = state.resolved[id];
    const tx = r?.tx ?? snapshots[id];
    if (!tx) return;
    setWriteErrorKey(null);
    setState((s) => unresolve(s, id));
    undo.mutate(
      { id, categoryId: tx.categoryId, confidence: tx.categoryConfidence },
      {
        onError: (err) => {
          // The row still holds what the line said; put the line back.
          if (r) setState((s) => (s.resolved[id] ? s : resolve(s, r)));
          onWriteError(err);
        },
      },
    );
  };

  if (list.isSuccess && lines.length === 0) {
    return (
      <Surface className="flex flex-col items-center gap-3 p-10 text-center">
        <PartyPopper className="size-8 text-green" aria-hidden />
        <h2 className="text-lg font-semibold text-fg">{t("budget.review.emptyTitle")}</h2>
        <p className="text-sm text-fg-faint">{t("budget.review.emptyBody")}</p>
        <Button variant="primary" onClick={() => navigate({ to: "/budget/overview" })}>
          {t("budget.review.backToOverview")}
        </Button>
      </Surface>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ReviewProgress resolved={resolvedCount} total={total} />
      <Surface className="p-6">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold text-fg">
            {t("budget.review.title")}
            <span className="ml-3 text-sm font-normal text-fg-faint">
              {t("budget.review.belowThreshold", { threshold: prefs.budgetAiThreshold })}
            </span>
          </h2>
          {resolvedCount > 0 && (
            <Button variant="ghost" onClick={() => setState(clearResolved)}>
              {t("budget.review.clearResolved")}
            </Button>
          )}
        </div>
        {writeErrorKey && (
          <p data-testid="write-error" role="alert" className="mb-3 flex items-center gap-2 text-xs text-red">
            {t(`budget.transactions.errors.${writeErrorKey}`)}
            <button
              type="button"
              data-testid="write-error-dismiss"
              onClick={() => setWriteErrorKey(null)}
              aria-label={t("common.close")}
              className="cursor-pointer text-red/70 hover:text-red"
            >
              ×
            </button>
          </p>
        )}
        <div className="flex flex-col gap-2">
          {lines.map((id) => {
            const r = state.resolved[id];
            if (r) {
              return (
                <ResolvedLine
                  key={id}
                  r={r}
                  busy={busy}
                  onUndo={() => onUndo(id)}
                  onApplyToOthers={() => runApplyToOthers(id, r.categoryId, false)}
                />
              );
            }
            const tx = pending.find((p) => p.id === id) ?? snapshots[id];
            return (
              <ReviewLine
                key={id}
                tx={tx}
                busy={busy}
                onAccept={() => onAccept(tx)}
                // The popover ignores clicks on its own anchor, so a second
                // click on Correct has to close it here.
                onCorrect={(anchor) =>
                  setCorrecting((c) => (c?.anchor === anchor ? null : { tx, anchor }))
                }
              />
            );
          })}
        </div>
        {list.hasNextPage && (
          <Button variant="ghost" className="mt-3" onClick={() => void list.fetchNextPage()}>
            {t("budget.transactions.loadMore")}
          </Button>
        )}
      </Surface>
      {correcting && (
        <CategoryChooser
          mode="pick"
          allowNone={false}
          selectedIds={correcting.tx.categoryId ? [correcting.tx.categoryId] : []}
          onPick={onPick}
          onClose={() => setCorrecting(null)}
          anchor={correcting.anchor}
        />
      )}
      {breakPair && (
        <BreakPairModal
          count={breakPair.count}
          busy={applyToDescription.isPending || patch.isPending}
          onConfirm={breakPair.run}
          onClose={() => setBreakPair(null)}
        />
      )}
    </div>
  );
}
