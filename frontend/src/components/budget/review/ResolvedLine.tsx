import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";

import { Button } from "../../Button";
import type { Resolution } from "../../../lib/review";

/** §3.3 — a resolved line stays in place, collapsed, with Undo. */
export function ResolvedLine({ r, busy, onUndo }: { r: Resolution; busy: boolean; onUndo: () => void }) {
  const { t } = useTranslation();
  return (
    <div data-testid={`resolved-line-${r.tx.id}`} className="flex items-center gap-3 rounded-xl px-4 py-2 text-sm">
      <Check className="size-4 text-green" aria-hidden />
      <span className="truncate uppercase text-fg-dim">{r.tx.description}</span>
      <span className="text-fg-faint">
        {r.outcome === "kept"
          ? t("budget.review.kept", { category: r.categoryName })
          : t("budget.review.correctedTo", { category: r.categoryName })}
      </span>
      <span className="flex-1" />
      <Button variant="ghost" disabled={busy} onClick={onUndo}>
        {t("budget.review.undo")}
      </Button>
    </div>
  );
}
