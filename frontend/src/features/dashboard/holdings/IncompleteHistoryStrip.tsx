import { useTranslation } from "react-i18next";

import { Button } from "../../../ui/Button";
import { formatQuantity } from "../../../lib/money";

/** Shown in both modes: the warning is about the holding, not the open tab. */
export function IncompleteHistoryStrip({
  unexplainedQty,
  onOpen,
}: {
  unexplainedQty: string;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const gap = Number(unexplainedQty);
  if (gap === 0) return null;
  return (
    <div className="bg-amber-soft rounded-2xl p-4 flex items-center justify-between gap-4">
      <div className="flex flex-col gap-1 min-w-0">
        <span className="text-fg text-sm font-semibold">
          {t("dashboard.holdings.gap.stripTitle")}
        </span>
        <span className="text-fg-dim text-sm">
          {t(
            gap > 0
              ? "dashboard.holdings.gap.stripBodyShort"
              : "dashboard.holdings.gap.stripBodyExcess",
            { qty: formatQuantity(String(Math.abs(gap))), count: Math.abs(gap) },
          )}
        </span>
      </div>
      {/* Filled so the button lifts off the strip's amber background and reads as a control. */}
      <Button variant="amber" onClick={onOpen} className="shrink-0">
        {t("dashboard.holdings.gap.open")}
      </Button>
    </div>
  );
}
