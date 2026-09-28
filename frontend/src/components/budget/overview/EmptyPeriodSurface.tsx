import { useTranslation } from "react-i18next";
import { CalendarX, ChevronLeft } from "lucide-react";

import { Surface } from "../../Surface";

/** Replaces the Sankey, the breakdown and the trend wholesale
 *  when the period has nothing in it. The figures above stay: zero is a true
 *  statement about the period, not a missing one. */
export function EmptyPeriodSurface({ onEarlier }: { onEarlier?: () => void }) {
  const { t } = useTranslation();
  return (
    <Surface data-testid="empty-period" className="flex flex-col items-center gap-2 p-16">
      <CalendarX className="size-6 text-fg-faint" />
      <p className="text-fg text-sm font-medium">{t("budget.overview.empty.title")}</p>
      <p className="max-w-md text-center text-sm text-fg-faint">
        {t("budget.overview.empty.body")}
      </p>
      {/* Offered only when there is data further back — the same condition
          as the back caret, repeated here where the reader is looking. */}
      {onEarlier && (
        <button
          type="button"
          data-testid="empty-earlier"
          onClick={onEarlier}
          className="mt-2 flex cursor-pointer items-center gap-0.5 text-sm text-fg-dim transition-colors duration-140 hover:text-fg"
        >
          <ChevronLeft className="size-4" />
          {t("budget.overview.empty.earlier")}
        </button>
      )}
    </Surface>
  );
}
