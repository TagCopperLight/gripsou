import { useTranslation } from "react-i18next";

import { Button } from "./Button";
import { formatQuantity } from "../lib/money";

/** Shown inside `AssetModal` when the recorded buys and sells do not add up to
 *  the position. It renders in BOTH modes: the warning is about the holding, not
 *  about which tab is open, and the purchases tab is exactly where an incomplete
 *  history is most misleading. */
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
            { qty: formatQuantity(String(Math.abs(gap))) },
          )}
        </span>
      </div>
      {/* Filled, not bordered: the strip's own background is already amber at
          0.15, so the button needs a stronger fill of the same hue to lift off
          it and read as a control rather than as more body text. */}
      <Button variant="amber" onClick={onOpen} className="shrink-0">
        {t("dashboard.holdings.gap.open")}
      </Button>
    </div>
  );
}
