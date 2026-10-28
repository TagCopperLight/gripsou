import { useTranslation } from "react-i18next";
import { CalendarX } from "lucide-react";

import { Surface } from "../../Surface";

/** Replaces the Sankey, the breakdown and the trend wholesale
 *  when the period has nothing in it. The figures above stay: zero is a true
 *  statement about the period, not a missing one. The month line's caret is
 *  the way back. */
export function EmptyPeriodSurface() {
  const { t } = useTranslation();
  return (
    <Surface data-testid="empty-period" className="flex flex-col items-center gap-2 p-16">
      <CalendarX className="size-6 text-fg-faint" />
      <p className="text-fg text-sm font-medium">{t("budget.overview.empty.title")}</p>
    </Surface>
  );
}
