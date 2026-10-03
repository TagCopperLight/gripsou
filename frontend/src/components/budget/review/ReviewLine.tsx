import { useTranslation } from "react-i18next";

import { TransactionAvatar } from "../TransactionAvatar";
import { CategoryChip } from "../CategoryChip";
import { Money } from "../../Money";
import { Button } from "../../Button";
import { formatDate } from "../../../lib/date";
import { categoryOfTransaction } from "../../../lib/budget";
import type { Transaction } from "../../../api/types";

type Props = {
  tx: Transaction;
  busy: boolean;
  onAccept: () => void;
  onCorrect: (anchor: HTMLElement) => void;
};

/** One pending guess in the review queue. A "no guess" row (the model abstained) can only
 *  be corrected. A confident guess into a neutral category is here because it
 *  hides money from every total, and says so. */
export function ReviewLine({ tx, busy, onAccept, onCorrect }: Props) {
  const { t } = useTranslation();
  const category = categoryOfTransaction(tx);
  const confidence = tx.categoryConfidence === null ? null : Math.round(Number(tx.categoryConfidence) * 100);
  const byKind = category !== null && tx.categoryKind === "neutral";

  return (
    <div data-testid={`review-line-${tx.id}`} className="flex items-center gap-4 rounded-xl bg-surface-2 px-4 py-3">
      <TransactionAvatar tx={tx} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium uppercase text-fg">{tx.description}</p>
        <p className="flex items-center gap-1.5 text-xs text-fg-faint">
          <span>{formatDate(tx.t)}</span>
          <span aria-hidden>·</span>
          <span className="truncate">{tx.accountName}</span>
          {byKind && (
            <>
              <span aria-hidden>·</span>
              <span className="text-amber">{t("budget.review.hidesMoney")}</span>
            </>
          )}
        </p>
      </div>
      {/* Fixed-width columns, so amounts, chips and buttons line up down the
          list whatever the chip's label or whether a guess exists. */}
      <Money value={tx.amount} currency={tx.currency} signed className="w-28 shrink-0 text-right text-fg" />
      <div className="flex w-40 shrink-0">
        <CategoryChip category={category} needsReview={category !== null} />
      </div>
      <span className="w-12 shrink-0 text-right font-mono text-sm text-fg-dim">
        {confidence === null ? "—" : `${confidence}%`}
      </span>
      {/* A "no guess" row has nothing to accept: keep the button's slot, hidden,
          so Correct stays in the same column as on every other line. */}
      <Button
        variant="ghostStrong"
        disabled={busy || category === null}
        onClick={onAccept}
        className={category === null ? "invisible" : ""}
        aria-hidden={category === null || undefined}
        tabIndex={category === null ? -1 : undefined}
      >
        {t("budget.review.accept")}
      </Button>
      <Button variant="ghost" disabled={busy} onClick={(e) => onCorrect(e.currentTarget)}>
        {t("budget.review.correct")}
      </Button>
    </div>
  );
}
