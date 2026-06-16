import { CloudOff, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

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
        <>
          <CloudOff className="size-6 text-fg-faint" />
          <div className="flex flex-col gap-0.5">
            <p className="text-fg text-sm font-medium">{t("common.cantReachServer")}</p>
            <p className="text-fg-faint text-xs">{t("common.apiUnavailable")}</p>
          </div>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-1 rounded-lg bg-surface-2 px-3 py-1 text-xs font-medium text-fg-dim hover:text-fg transition-colors duration-140 cursor-pointer"
            >
              {t("common.retry")}
            </button>
          )}
        </>
      )}
    </div>
  );
}
