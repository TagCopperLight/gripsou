import { useTranslation } from "react-i18next";
import { ChartColumn } from "lucide-react";

import { Surface } from "../Surface";

/** Stands in for the whole page when no account holds a security (cash
 *  doesn't count on this page), connections or not. */
export function InvestmentsEmpty() {
  const { t } = useTranslation();
  return (
    <Surface className="mt-4 flex flex-col items-center gap-2 p-16">
      <ChartColumn className="size-6 text-fg-faint" />
      <p className="text-fg text-sm font-medium">{t("investments.empty.title")}</p>
      <p className="max-w-md text-center text-sm text-fg-faint">{t("investments.empty.body")}</p>
    </Surface>
  );
}
