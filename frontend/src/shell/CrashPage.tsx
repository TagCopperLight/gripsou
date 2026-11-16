import { useTranslation } from "react-i18next";

import { ErrorState } from "../ui/ErrorState";

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
