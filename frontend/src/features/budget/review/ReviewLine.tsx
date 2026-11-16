import { useTranslation } from "react-i18next";

import { TransactionAvatar } from "../TransactionAvatar";
import { CategoryChip } from "../CategoryChip";
import { Money } from "../../../ui/Money";
import { MoneyHint } from "../../../ui/MoneyHint";
import { Button } from "../../../ui/Button";
import { formatDay } from "../../../lib/date";
import { categoryOfTransaction } from "../../../lib/budget";
import type { Transaction } from "../../../api/wire";
import { usePhone } from "../../../ui/usePhone";
import { ACCEPT_BUTTON, AMOUNT_COL, CHIP_COL, GUESS_GROUP, CONFIDENCE_COL, CORRECT_BUTTON, REVIEW_ROW, TEXT_COL } from "./reviewColumns";

type Props = {
  tx: Transaction;
  busy: boolean;
  onAccept: () => void;
  onCorrect: (anchor: HTMLElement) => void;
};

/** A "no guess" row (the model abstained) can only be corrected. */
export function ReviewLine({ tx, busy, onAccept, onCorrect }: Props) {
  const { t } = useTranslation();
  const phone = usePhone();
  const category = categoryOfTransaction(tx);
  const confidence = tx.categoryConfidence === null ? null : Math.round(Number(tx.categoryConfidence) * 100);

  return (
    <div data-testid={`review-line-${tx.id}`} className={REVIEW_ROW}>
      {/* A phone drops it: the guess below names the same category. */}
      {!phone && <TransactionAvatar tx={tx} />}
      <div className={TEXT_COL}>
        <p className="truncate text-sm font-medium uppercase text-fg">{tx.description}</p>
        <p className="flex items-center gap-1.5 text-xs text-fg-faint">
          <span>{formatDay(tx.t)}</span>
          <span aria-hidden>·</span>
          <span className="truncate">{tx.accountName}</span>
        </p>
      </div>
      <span className={`${AMOUNT_COL} text-right`}>
        <MoneyHint currency={tx.currency} converted={tx.amountReporting} signed>
          <Money value={tx.amount} currency={tx.currency} signed className="text-fg" />
        </MoneyHint>
      </span>
      <div className={GUESS_GROUP}>
        <div className={CHIP_COL}>
          <CategoryChip category={category} needsReview={category !== null} look={phone ? "text" : "chip"} />
        </div>
        <span className={`${CONFIDENCE_COL} text-right font-mono text-sm text-fg-dim`}>
          {confidence === null ? "—" : `${confidence}%`}
        </span>
      </div>
      {/* A "no guess" row has nothing to accept: the hidden button keeps Correct in the same column. */}
      <Button
        variant="ghostStrong"
        disabled={busy || category === null}
        onClick={onAccept}
        className={`${ACCEPT_BUTTON} ${category === null ? "invisible" : ""}`}
        aria-hidden={category === null || undefined}
        tabIndex={category === null ? -1 : undefined}
      >
        {t("budget.review.accept")}
      </Button>
      <Button variant="ghost" disabled={busy} onClick={(e) => onCorrect(e.currentTarget)} className={CORRECT_BUTTON}>
        {t("budget.review.correct")}
      </Button>
    </div>
  );
}
