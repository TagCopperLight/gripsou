import { useTranslation } from "react-i18next";
import { CalendarX } from "lucide-react";

import { Surface } from "../../../ui/Surface";

/** Replaces the Sankey, breakdown and trend when the period has nothing in it. */
export function EmptyPeriodSurface() {
  const { t } = useTranslation();
  return (
    <Surface data-testid="empty-period" className="flex flex-col items-center gap-2 p-16">
      <CalendarX className="size-6 text-fg-faint" />
      <p className="text-fg text-sm font-medium">{t("budget.overview.empty.title")}</p>
    </Surface>
  );
}
