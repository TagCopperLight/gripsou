import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ErrorState } from "./ErrorState";

type CardStateProps = {
  /** "loading" while the query is in flight; "error" once it has failed. */
  variant: "loading" | "error";
  /** Re-run the failed query; renders a Retry button when provided. */
  onRetry?: () => void;
  /** Sizing/spacing for the placeholder, e.g. "mt-4 h-80" to fill a chart slot. */
  className?: string;
};

// A centered placeholder shown in a card's content area whenever its API data
// is still loading or unreachable, so the app degrades gracefully when the
// backend is down instead of rendering empty cards.
export function CardState({ variant, onRetry, className = "" }: CardStateProps) {
  const { t } = useTranslation();
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 text-center ${className}`}
    >
      {variant === "loading" ? (
        <>
          <Loader2 className="size-6 text-fg-faint animate-spin" />
          <p className="text-fg-faint text-sm">{t("common.loading")}</p>
        </>
      ) : (
        <ErrorState
          title={t("common.loadFailed")}
          detail={t("common.loadFailedDetail")}
          action={onRetry && { label: t("common.retry"), onClick: onRetry }}
        />
      )}
    </div>
  );
}
