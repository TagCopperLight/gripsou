import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CircleAlert } from "lucide-react";
import type { CurrencyPick } from "./useCurrencyChange";

/** What a currency pick is waiting for, or why it was refused; `idle` otherwise. */
export function CurrencyChangeHint({ pick, idle = null }: { pick: CurrencyPick; idle?: ReactNode }) {
  const { t } = useTranslation();
  if (pick?.state === "fetching") return t("fx.fetching", { currency: pick.code });
  if (pick?.state === "refused")
    return (
      <span role="alert" className="inline-flex items-center gap-1.5 text-red">
        <CircleAlert className="size-3.5 shrink-0" />
        {t("fx.refused", { currency: pick.code })}
      </span>
    );
  return idle;
}
