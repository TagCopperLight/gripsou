import { useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

import { LoadingFrame } from "./LoadingFrame";
import { Modal } from "./Modal";

type DialogProps = {
  title: string;
  /** Shown when it differs from the accessible name, e.g. a live preview that must not rename the dialog. */
  heading?: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  icon?: ReactNode;
  busy?: boolean;
  large?: boolean;
  wide?: boolean;
  aside?: ReactNode;
};

/** Behaviour (focus trap, Escape, `busy`) is [`Modal`](./Modal.tsx)'s. While `busy`, every control is off too. */
export function Dialog({
  title, heading, subtitle, onClose, children, footer, icon, busy = false, large = false, wide = false, aside,
}: DialogProps) {
  const { t } = useTranslation();
  const body = useRef<HTMLDivElement>(null);
  const actions = useRef<HTMLDivElement>(null);

  return (
    <Modal
      label={title}
      onClose={onClose}
      busy={busy}
      focusWithin={[body, actions]}
      className={`relative ${wide ? "w-170" : large ? "w-160" : "w-120"} max-w-[90vw] max-h-[90vh] bg-surface rounded-3xl flex flex-col`}
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
            className="p-1.5 rounded-lg text-fg-faint hover:bg-surface-2 hover:text-fg transition-colors duration-140 cursor-pointer"
          >
            <X className="size-5" />
          </button>
        </div>
      </div>
      <div ref={body} className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <LoadingFrame loading={busy}>{children}</LoadingFrame>
      </div>
      {footer && (
        <div ref={actions} className="flex shrink-0 items-center justify-end gap-2 px-6 pb-6 pt-2">
          <LoadingFrame loading={busy}>{footer}</LoadingFrame>
        </div>
      )}
    </Modal>
  );
}
