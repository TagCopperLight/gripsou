import type { ReactNode, RefObject } from "react";

import { FloatingPanel } from "./FloatingPanel";

type PopoverProps = {
  /** Accessible name: a popover carries no visible heading. */
  title: string;
  /** See `FloatingPanel`: the panel hangs under this, left-aligned with it. */
  anchor?: HTMLElement | null;
  onClose: () => void;
  /** The field that takes focus once the popover is placed. */
  initialFocus?: RefObject<HTMLElement | null>;
  children: ReactNode;
};

/** A light, non-modal alternative to `Dialog` for picking from a list. */
export function Popover({ title, anchor = null, onClose, initialFocus, children }: PopoverProps) {
  return (
    <FloatingPanel
      anchor={anchor}
      onClose={onClose}
      initialFocus={initialFocus}
      role="dialog"
      aria-label={title}
      data-testid="popover"
      // No padding of its own: content that wants to reach the edge (a search
      // field set into the top) must be able to, and `overflow-hidden` is what
      // keeps it inside the rounding.
      className="w-72 max-w-[calc(100vw-1rem)] overflow-hidden rounded-2xl border border-surface-3 bg-surface-2 shadow-lg outline-none"
    >
      {children}
    </FloatingPanel>
  );
}
