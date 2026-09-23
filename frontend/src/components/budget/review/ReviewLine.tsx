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

/** §3.2 — one pending guess. A "no guess" row (the model abstained) can only
 *  be corrected. A confident guess into internal/excluded is here because of
 *  its kind, and says so. */
export function ReviewLine({ tx, busy, onAccept, onCorrect }: Props) {
  const { t } = useTranslation();
  const category = categoryOfTransaction(tx);
  const confidence = tx.categoryConfidence === null ? null : Math.round(Number(tx.categoryConfidence) * 100);
  const byKind = category !== null && (tx.categoryKind === "internal" || tx.categoryKind === "excluded");

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
      <Money value={tx.amount} currency={tx.currency} signed className="text-fg" />
      <CategoryChip category={category} needsReview={category !== null} />
      <span className="w-12 text-right font-mono text-sm text-fg-dim">
        {confidence === null ? "—" : `${confidence}%`}
      </span>
      {category !== null && (
        <Button variant="ghostStrong" disabled={busy} onClick={onAccept}>
          {t("budget.review.accept")}
        </Button>
      )}
      <Button variant="ghost" disabled={busy} onClick={(e) => onCorrect(e.currentTarget)}>
        {t("budget.review.correct")}
      </Button>
    </div>
  );
}
