import { useTranslation } from "react-i18next";

import { Surface } from "../../components/Surface";
import { BudgetIcon } from "../../lib/budget";

/** Phase 3 placeholder. Phase 4 replaces this file wholesale with the real
 *  analysis view; nothing else imports it. */
export function BudgetOverview() {
  const { t } = useTranslation();
  return (
    <Surface className="flex flex-col items-center gap-2 p-16">
      <BudgetIcon className="size-6 text-fg-faint" />
      <p className="text-sm text-fg-faint">{t("budget.overviewSoon")}</p>
    </Surface>
  );
}
