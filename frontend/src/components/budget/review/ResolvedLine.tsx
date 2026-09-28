import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";

import { Button } from "../../Button";
import type { Resolution } from "../../../lib/review";

type Props = {
  r: Resolution;
  busy: boolean;
  onUndo: () => void;
  onApplyToOthers: () => void;
};

const OUTCOME_KEY = {
  kept: "budget.review.kept",
  corrected: "budget.review.correctedTo",
  applied: "budget.review.appliedAs",
} as const;

/** A resolved line stays in place, collapsed, with Undo. When other
 *  rows share its description it offers to widen the category to them, as
 *  the transactions list does after a correction — inline, so the review
 *  flow is never interrupted. */
export function ResolvedLine({ r, busy, onUndo, onApplyToOthers }: Props) {
  const { t } = useTranslation();
  return (
    <div data-testid={`resolved-line-${r.tx.id}`} className="flex items-center gap-3 rounded-xl px-4 py-2 text-sm">
      <Check className="size-4 text-green" aria-hidden />
      <span className="truncate uppercase text-fg-dim">{r.tx.description}</span>
      <span className="text-fg-faint">{t(OUTCOME_KEY[r.outcome], { category: r.categoryName })}</span>
      <span className="flex-1" />
      {r.appliedTo !== undefined ? (
        <span className="text-fg-faint">{t("budget.review.appliedToOthers", { count: r.appliedTo })}</span>
      ) : (
        !!r.sameCount && (
          <Button variant="ghostStrong" disabled={busy} onClick={onApplyToOthers}>
            {t("budget.review.applyToOthers", { count: r.sameCount })}
          </Button>
        )
      )}
      <Button variant="ghost" disabled={busy} onClick={onUndo}>
        {t("budget.review.undo")}
      </Button>
    </div>
  );
}
