import {
  useEffect, useLayoutEffect, useRef, useState,
  type CSSProperties, type HTMLAttributes, type ReactNode, type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { isTopPanel, popPanel, pushPanel } from "./panelStack";

type FloatingPanelProps = Omit<HTMLAttributes<HTMLDivElement>, "style" | "className"> & {
  /** A press on it is not an outside press, so it can toggle the panel (`usePopover`). `null` places the panel at the top centre. */
  anchor: HTMLElement | null;
  onClose: () => void;
  align?: "start" | "end" | "match";
  initialFocus?: RefObject<HTMLElement | null>;
  className: string;
  style?: CSSProperties;
  children: ReactNode;
};

const GAP = 6;
const MARGIN = 8;

/** No backdrop, scroll lock or focus trap: modal weight belongs to writes that
 *  must be finished or abandoned. Escape closes only the topmost panel. */
export function FloatingPanel({
  anchor, onClose, align = "start", initialFocus, className, style, children, ...rest
}: FloatingPanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width?: number } | null>(null);
  // Inside a modal it joins the modal's node to stay in its focus trap. `fixed`
  // either way: a transformed or backdrop-filtered ancestor would become the
  // containing block and misplace viewport coordinates.
  const host = anchor?.closest<HTMLElement>("[aria-modal=true]") ?? document.body;

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
      // Flip only with no room below and more above: otherwise clamping beats a panel jumping sides.
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
    // Capture: the scroll that moves the anchor is usually on an inner container, and those don't bubble.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchor, align]);

  // `autoFocus` can't: the panel is hidden at mount and browsers refuse to focus it.
  const placed = pos !== null;
  useEffect(() => {
    if (placed) initialFocus?.current?.focus();
  }, [placed, initialFocus]);

  // Read through refs: callers pass a fresh `onClose` every render, and as
  // dependencies each toggle would re-run the cleanup below and throw focus back
  // to the anchor.
  const onCloseRef = useRef(onClose);
  const anchorRef = useRef(anchor);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
    anchorRef.current = anchor;
  }, [onClose, anchor]);

  useEffect(() => {
    const id = pushPanel();
    // Capture on the window, so the Escape that closes the panel never also closes a modal under it.
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

  // Cleanup runs while the panel is still in the page: focus inside goes back to the anchor, elsewhere stays.
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
