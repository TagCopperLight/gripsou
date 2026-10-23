import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

import { Modal } from "./Modal";

type DialogProps = {
  title: string;
  /** Visible heading when it differs from the accessible name — e.g. a live
      preview of what the user is typing, which must not rename the dialog. */
  heading?: ReactNode;
  /** A line under the heading. */
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  icon?: ReactNode;
  busy?: boolean;
  large?: boolean;
  /** Shown in the header, just before the close button (e.g. step progress). */
  aside?: ReactNode;
};

/** The app's standard modal: a header with the title and a close button, a
 *  body that scrolls, and a footer of actions that stays in view. The
 *  behaviour (focus trap, Escape, `busy`) is [`Modal`](./Modal.tsx)'s. */
export function Dialog({
  title, heading, subtitle, onClose, children, footer, icon, busy = false, large = false, aside,
}: DialogProps) {
  const { t } = useTranslation();

  return (
    <Modal
      label={title}
      onClose={onClose}
      busy={busy}
      className={`relative ${large ? "w-160" : "w-120"} max-w-[90vw] max-h-[90vh] bg-surface rounded-3xl flex flex-col`}
    >
      <div className="flex shrink-0 items-center justify-between px-6 pt-6 pb-2">
        <div className="flex flex-col gap-1">
          <h2 className="flex items-center gap-2.5 text-xl font-semibold text-fg">
            {icon}
            {heading ?? title}
          </h2>
          {subtitle && <p className="text-sm font-medium text-fg-faint">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-3">
          {aside}
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label={t("common.close")}
            className="p-1.5 rounded-lg text-fg-faint hover:bg-surface-2 hover:text-fg transition-colors duration-140 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <X className="size-5" />
          </button>
        </div>
      </div>
      <div data-modal-body className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>
      {footer && (
        <div data-modal-footer className="flex shrink-0 items-center justify-end gap-2 px-6 pb-6 pt-2">
          {footer}
        </div>
      )}
    </Modal>
  );
}
