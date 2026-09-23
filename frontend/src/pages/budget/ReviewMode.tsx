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
import { useTransactions } from "../../api/hooks";
import {
  useAcceptReview, useAiStatus, useBudgetCategories, usePatchTransaction, useUndoReview,
} from "../../api/budget";
import { categoryLabel, categoryOfTransaction } from "../../lib/budget";
import {
  clearResolved, initialReview, resolve, syncPending, unresolve, type ReviewState,
} from "../../lib/review";
import type { Transaction, TransactionFilterQuery } from "../../api/types";

/** The queue is all-time and includes internal transfers, which a guess can
 *  land in (spec §5.1) — the list hides them by default. */
const QUEUE: TransactionFilterQuery = { needsReview: true, includeTransfers: true };

export function ReviewMode() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const status = useAiStatus().data;
  const list = useTransactions(QUEUE);
  const categories = useBudgetCategories().data ?? [];
  const accept = useAcceptReview();
  const undo = useUndoReview();
  const patch = usePatchTransaction();

  const pending: Transaction[] = useMemo(() => list.data?.pages.flat() ?? [], [list.data]);
  const [state, setState] = useState<ReviewState>(initialReview);
  const [snapshots, setSnapshots] = useState<Record<string, Transaction>>({});
  const [correcting, setCorrecting] = useState<{ tx: Transaction; anchor: HTMLElement } | null>(null);

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

  const busy = accept.isPending || undo.isPending || patch.isPending;
  const resolvedCount = Object.keys(state.resolved).length;
  const pendingIds = new Set(pending.map((p) => p.id));
  const lines = state.order.filter((id) => state.resolved[id] || pendingIds.has(id));

  const onAccept = (tx: Transaction) => {
    const cat = categoryOfTransaction(tx);
    accept.mutate(tx.id);
    setState((s) => resolve(s, { tx, outcome: "kept", categoryName: cat ? categoryLabel(t, cat) : "" }));
  };

  const onPick = (id: string | null) => {
    if (!correcting || !id) return;
    const { tx } = correcting;
    const cat = categories.find((c) => c.id === id);
    patch.mutate({ id: tx.id, body: { categoryId: id } });
    setState((s) => resolve(s, { tx, outcome: "corrected", categoryName: cat ? categoryLabel(t, cat) : "" }));
    setCorrecting(null);
  };

  const onUndo = (id: string) => {
    const tx = state.resolved[id]?.tx ?? snapshots[id];
    if (!tx) return;
    undo.mutate({ id, categoryId: tx.categoryId, confidence: tx.categoryConfidence });
    setState((s) => unresolve(s, id));
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
      <ReviewProgress resolved={resolvedCount} total={state.total} />
      <Surface className="p-6">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold text-fg">
            {t("budget.review.title")}{" "}
            <span className="text-sm font-normal text-fg-faint">
              {t("budget.review.belowThreshold", { threshold: status?.threshold ?? 80 })}
            </span>
          </h2>
          {resolvedCount > 0 && (
            <Button variant="ghost" onClick={() => setState(clearResolved)}>
              {t("budget.review.clearResolved")}
            </Button>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {lines.map((id) => {
            const r = state.resolved[id];
            if (r) return <ResolvedLine key={id} r={r} busy={busy} onUndo={() => onUndo(id)} />;
            const tx = pending.find((p) => p.id === id) ?? snapshots[id];
            return (
              <ReviewLine
                key={id}
                tx={tx}
                busy={busy}
                onAccept={() => onAccept(tx)}
                onCorrect={(anchor) => setCorrecting({ tx, anchor })}
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
    </div>
  );
}
