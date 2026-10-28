import { useTranslation } from "react-i18next";

import { FxFootnote } from "../FxNote";
import type { ReturnFigures } from "../../api/types";
import { leavesOut } from "../../lib/returns";

/** The lines under a returns card saying which holdings its figures leave
 *  out, one per reason; nothing when none is. */
export function ExcludedNotes({ figures, className = "" }: { figures: ReturnFigures; className?: string }) {
  const { t } = useTranslation();
  if (!leavesOut(figures)) return null;
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {figures.excludedHistory > 0 && (
        <FxFootnote>{t("investments.excludedHistory", { count: figures.excludedHistory })}</FxFootnote>
      )}
      {figures.excludedRate > 0 && <FxFootnote>{t("fx.excludes", { count: figures.excludedRate })}</FxFootnote>}
    </div>
  );
}
