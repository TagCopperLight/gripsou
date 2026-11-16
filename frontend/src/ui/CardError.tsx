import { useTranslation } from "react-i18next";

import { ErrorState } from "./ErrorState";

export function CardError({ onRetry, className = "" }: {
  onRetry?: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <ErrorState
      className={className}
      title={t("common.loadFailed")}
      detail={t("common.tryAgain")}
      action={onRetry && { label: t("common.retry"), onClick: onRetry }}
    />
  );
}
