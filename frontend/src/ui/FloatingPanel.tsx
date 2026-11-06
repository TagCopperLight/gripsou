import {
  useEffect, useLayoutEffect, useRef, useState,
  type CSSProperties, type HTMLAttributes, type ReactNode, type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { isTopPanel, popPanel, pushPanel } from "./panelStack";

type FloatingPanelProps = Omit<HTMLAttributes<HTMLDivElement>, "style" | "className"> & {
  /** The element that opened it: the panel hangs under it (above it when the
   *  screen has no room below), and a press on it does not count as a press
   *  outside, so it can toggle the panel (`usePopover`). `null` (tests, or a
   *  caller with nothing to anchor to) places it at the top centre of the
   *  viewport. */
  anchor: HTMLElement | null;
  onClose: () => void;
  /** Which of the anchor's edges the panel lines up with; `match` also takes
   *  the anchor's width. */
  align?: "start" | "end" | "match";
  /** Takes focus once the panel is placed, so typing starts at once. */
  initialFocus?: RefObject<HTMLElement | null>;
  className: string;
  style?: CSSProperties;
  children: ReactNode;
};

/** Gap between the anchor and the panel, and the margin kept from the
 *  viewport edges when the panel has to be nudged back inside. */
const GAP = 6;
const MARGIN = 8;

/** Everything that floats over the page from a control (a menu, a chooser, a
 *  colour picker): placed against its anchor, closed by Escape or by a press
 *  anywhere outside, and focus handed back to the anchor when it closes from
 *  inside. No backdrop, no scroll lock, no focus trap: modal weight belongs to
 *  writes that must be finished or abandoned. Escape closes the topmost panel
 *  only, never a window under it. */
export function FloatingPanel({
  anchor, onClose, align = "start", initialFocus, className, style, children, ...rest
}: FloatingPanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width?: number } | null>(null);
  // Inside a modal, the panel joins the modal's node so it stays inside its
  // focus trap. `fixed` either way: a transformed or backdrop-filtered
  // ancestor (the selection bar is both) would become a containing block and
  // send viewport coordinates to the wrong origin.
  const host = anchor?.closest<HTMLElement>("[aria-modal=true]") ?? document.body;

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

      const width = align === "match" ? rect.width : panel.width;
      const below = rect.bottom + GAP;
      // Flip above only when there is genuinely no room below *and* more room
      // above: otherwise staying put and clamping reads better than a panel
      // that jumps sides on a small window.
      const fitsBelow = below + panel.height <= vh - MARGIN;
      const top = fitsBelow || rect.top < vh - rect.bottom
        ? Math.min(below, Math.max(MARGIN, vh - MARGIN - panel.height))
        : Math.max(MARGIN, rect.top - GAP - panel.height);
      const wanted = align === "end" ? rect.right - width : rect.left;

      setPos({
        top,
        left: Math.min(Math.max(MARGIN, wanted), Math.max(MARGIN, vw - MARGIN - width)),
        width: align === "match" ? width : undefined,
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
  }, [anchor, align]);

  // `autoFocus` cannot do this: at mount the panel is still hidden (see the
  // style below) and browsers refuse to focus an invisible element.
  const placed = pos !== null;
  useEffect(() => {
    if (placed) initialFocus?.current?.focus();
  }, [placed, initialFocus]);

  // The latest `onClose` and `anchor`, read through refs: callers hand in a
  // fresh close function on every render, and a multi-select chooser
  // re-renders its parent on every toggle. Were they dependencies, each toggle
  // would re-run the cleanup below and throw focus back to the anchor: the
  // next Enter would then press the anchor instead of picking a line.
  const onCloseRef = useRef(onClose);
  const anchorRef = useRef(anchor);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
    anchorRef.current = anchor;
  }, [onClose, anchor]);

  useEffect(() => {
    const id = pushPanel();
    // On the window, in the capture phase: it runs before any other handler,
    // so the Escape that closes the panel never also closes a modal under it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !isTopPanel(id)) return;
      e.stopPropagation();
      e.stopImmediatePropagation();
      onCloseRef.current();
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      popPanel(id);
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  // A layout effect's cleanup runs while the panel is still in the page, so it
  // can tell whether focus was inside it: then it goes back to the anchor (the
  // panel is a detour, not a destination). Focus somewhere else stays there.
  useLayoutEffect(() => {
    const node = ref.current;
    return () => {
      if (node?.contains(document.activeElement)) anchorRef.current?.focus?.();
    };
  }, []);

  return createPortal(
    <div
      ref={ref}
      {...rest}
      // Hidden until measured, so the first paint is never at the wrong place.
      style={{
        ...style,
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        width: pos?.width ?? style?.width,
        visibility: pos ? "visible" : "hidden",
      }}
      className={`fixed z-60 ${className}`}
    >
      {children}
    </div>,
    host,
  );
}
