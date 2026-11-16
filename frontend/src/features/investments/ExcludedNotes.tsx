import { useTranslation } from "react-i18next";

import { ExcludedFootnote, FxFootnote } from "../../ui/FxNote";
import type { ReturnFigures } from "../../api/wire";
import { leavesOut } from "../../lib/returns";

export function ExcludedNotes({ figures, className = "" }: { figures: ReturnFigures; className?: string }) {
  const { t } = useTranslation();
  if (!leavesOut(figures)) return null;
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {figures.excludedHistory > 0 && (
        <FxFootnote>{t("investments.excludedHistory", { count: figures.excludedHistory })}</FxFootnote>
      )}
      {figures.excludedRate > 0 && <ExcludedFootnote count={figures.excludedRate} />}
    </div>
  );
}
