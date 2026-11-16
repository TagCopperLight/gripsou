import type { ReactNode, RefObject } from "react";

import { FloatingPanel } from "./FloatingPanel";

type PopoverProps = {
  title: string;
  anchor?: HTMLElement | null;
  onClose: () => void;
  initialFocus?: RefObject<HTMLElement | null>;
  children: ReactNode;
};

export function Popover({ title, anchor = null, onClose, initialFocus, children }: PopoverProps) {
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
