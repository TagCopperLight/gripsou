import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";

import { Button } from "../../../ui/Button";
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

/** Stays in place, collapsed, with Undo. Offers to widen the category to rows sharing its description, inline so the review flow is never interrupted. */
export function ResolvedLine({ r, busy, onUndo, onApplyToOthers }: Props) {
  const { t } = useTranslation();
  return (
    <div data-testid={`resolved-line-${r.tx.id}`} className="flex items-center gap-3 rounded-xl px-4 py-2 text-sm max-md:flex-wrap max-md:gap-y-0 max-md:px-3">
      <Check className="size-4 text-green" aria-hidden />
      <span className="truncate uppercase text-fg-dim max-md:min-w-0 max-md:flex-1">{r.tx.description}</span>
      {/* On a phone the outcome takes its own line, under the description. */}
      <span className="text-fg-faint max-md:order-last max-md:basis-full max-md:pl-7">{t(OUTCOME_KEY[r.outcome], { category: r.categoryName })}</span>
      <span className="flex-1 max-md:hidden" />
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
