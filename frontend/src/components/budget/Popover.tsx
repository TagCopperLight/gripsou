import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type PopoverProps = {
  /** Accessible name — a popover carries no visible heading. */
  title: string;
  /** The element that opened it: the panel hangs under this, left-aligned
   *  with it, and a click on it does not count as a click outside. `null`
   *  (tests, or a caller with nothing to anchor to) falls back to the top
   *  centre of the viewport. */
  anchor?: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
  className?: string;
};

/** Gap between the anchor and the panel, and the margin kept from the
 *  viewport edges when the panel has to be nudged back inside. */
const GAP = 6;
const MARGIN = 8;

/** A light, non-modal alternative to `BudgetDialog`: no backdrop, no scroll
 *  lock, no focus trap — it sits under whatever opened it and closes on
 *  Escape or on a click anywhere outside. Modal weight belongs to writes that
 *  must be finished or abandoned; picking from a list is neither. */
export function Popover({ title, anchor = null, onClose, children, className = "" }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Measured after layout (and again on scroll/resize) so the flip decision
  // sees the panel's real height rather than a guess.
  useLayoutEffect(() => {
    const place = () => {
      const node = ref.current;
      if (!node) return;
      const panel = node.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const rect = anchor?.getBoundingClientRect();

      if (!rect) {
        setPos({ top: MARGIN * 6, left: Math.max(MARGIN, (vw - panel.width) / 2) });
        return;
      }

      const below = rect.bottom + GAP;
      // Flip above only when there is genuinely no room below *and* more room
      // above — otherwise staying put and clamping reads better than a panel
      // that jumps sides on a small window.
      const fitsBelow = below + panel.height <= vh - MARGIN;
      const top = fitsBelow || rect.top < vh - rect.bottom
        ? Math.min(below, Math.max(MARGIN, vh - MARGIN - panel.height))
        : Math.max(MARGIN, rect.top - GAP - panel.height);

      setPos({
        top,
        left: Math.min(Math.max(MARGIN, rect.left), Math.max(MARGIN, vw - MARGIN - panel.width)),
      });
    };

    place();
    // Capture phase: the scroll that moves the anchor is usually on some inner
    // container, and those do not bubble.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || anchor?.contains(target)) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
      // Hand focus back to what opened it: the popover is a detour, not a
      // destination.
      anchor?.focus?.();
    };
  }, [anchor, onClose]);

  // Portalled to the body: the panel is `fixed`, and any transformed or
  // backdrop-filtered ancestor (the selection bar is both) would become its
  // containing block and send viewport coordinates to the wrong origin.
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={title}
      data-testid="popover"
      // Hidden until measured, so the first paint is never at the wrong place.
      style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? "visible" : "hidden" }}
      // No padding of its own: content that wants to reach the edge (a search
      // field set into the top) must be able to, and `overflow-hidden` is what
      // keeps it inside the rounding.
      className={`fixed z-50 w-72 max-w-[calc(100vw-1rem)] overflow-hidden rounded-2xl border border-surface-3 bg-surface-2 shadow-lg outline-none ${className}`}
    >
      {children}
    </div>,
    document.body,
  );
}
