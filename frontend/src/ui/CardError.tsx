import { useTranslation } from "react-i18next";

import { ErrorState } from "./ErrorState";

/** What a card shows in its content area when its API data couldn't load, so
 *  the app degrades gracefully when the backend is down instead of rendering
 *  empty cards. */
export function CardError({ onRetry, className = "" }: {
  /** Re-run the failed query; renders a Retry button when provided. */
  onRetry?: () => void;
  /** Sizing/spacing, e.g. "mt-4 h-80" to fill a chart slot. */
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
