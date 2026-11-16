import { useEffect, useRef, type ReactNode, type RefObject } from "react";

import { createPortal } from "react-dom";

import { FloatingPanel } from "./FloatingPanel";
import { Modal } from "./Modal";
import { PHONE_SHEET } from "./sheet";
import { usePhone } from "./usePhone";

type PopoverProps = {
  title: string;
  anchor?: HTMLElement | null;
  onClose: () => void;
  initialFocus?: RefObject<HTMLElement | null>;
  children: ReactNode;
};

export function Popover({ title, anchor = null, onClose, initialFocus, children }: PopoverProps) {
  const phone = usePhone();
  if (phone) {
    // Portalled like FloatingPanel: a filtered or transformed ancestor would trap a fixed overlay inside itself.
    return createPortal(
      <Modal label={title} onClose={onClose} className={`relative flex flex-col overflow-hidden bg-surface-2 rounded-3xl ${PHONE_SHEET}`}>
        <SheetBody title={title}>{children}</SheetBody>
      </Modal>,
      document.body,
    );
  }
  return (
    <FloatingPanel
      anchor={anchor}
      onClose={onClose}
      initialFocus={initialFocus}
      role="dialog"
      aria-label={title}
      data-testid="popover"
      // No padding, so content can reach the edge; `overflow-hidden` keeps it inside the rounding.
      className="w-72 max-w-[calc(100vw-1rem)] overflow-hidden rounded-2xl border border-surface-3 bg-surface-2 shadow-lg outline-none"
    >
      {children}
    </FloatingPanel>
  );
}

/** Takes focus before the modal looks for a control: a focused field would raise the keyboard over half the sheet. */
function SheetBody({ title, children }: { title: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div ref={ref} data-testid="popover" tabIndex={-1} className="flex min-h-0 flex-col outline-none">
      <p className="px-4 pt-4 pb-1 text-sm font-semibold text-fg">{title}</p>
      {children}
    </div>
  );
}
