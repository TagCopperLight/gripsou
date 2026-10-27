import { useTranslation } from "react-i18next";

import { ErrorState } from "./ErrorState";

/** What a page that broke while showing says instead. Reloading starts the
 *  app afresh, which is what fixes it nearly every time. */
export function CrashPage() {
  const { t } = useTranslation();
  return (
    <ErrorState
      title={t("common.crashed")}
      detail={t("common.crashedDetail")}
      action={{ label: t("common.reload"), onClick: () => window.location.reload() }}
      className="min-h-[60vh] px-6"
    />
  );
}
