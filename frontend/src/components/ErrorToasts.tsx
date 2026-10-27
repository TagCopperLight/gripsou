import { CircleAlert, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { dismissError, useErrorToasts } from "../lib/errorToasts";

/** Failed actions, in the bottom-right corner of the screen, above any open
 *  window, newest at the bottom. Each goes after 5 seconds, or when closed. */
export function ErrorToasts() {
  const { t } = useTranslation();
  const toasts = useErrorToasts();
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-80 flex flex-col items-end gap-2 md:inset-x-auto md:right-6 md:bottom-6">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="alert"
          data-testid="error-toast"
          className="pointer-events-auto flex w-full animate-toast-in items-center gap-3 rounded-2xl border border-surface-3 bg-surface-2 p-2.5 shadow-[0_16px_40px_rgba(0,0,0,0.55)] motion-reduce:animate-none md:w-82.5"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-red-soft text-red">
            <CircleAlert className="size-4" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="text-[13px] leading-[1.4] font-medium text-fg">{toast.title}</p>
            {toast.detail !== null && (
              <p className="text-xs text-fg-dim">{toast.detail ?? t("common.tryAgain")}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => dismissError(toast.id)}
            aria-label={t("common.dismiss")}
            className="shrink-0 cursor-pointer rounded-lg p-1 text-fg-faint transition-colors duration-140 hover:text-fg"
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
