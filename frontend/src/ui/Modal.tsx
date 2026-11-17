import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { isPhone } from "./usePhone";

type ModalProps = {
  label: string;
  onClose: () => void;
  busy?: boolean;
  className: string;
  /** Focus lands on the first control of the first of these that has one, else the first control. `autoFocus` overrides. Not on a phone. */
  focusWithin?: RefObject<HTMLElement | null>[];
  children: ReactNode;
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Inert while `busy`, so a write in flight cannot be abandoned. */
export function Modal({ label, onClose, busy = false, className, focusWithin = [], children }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Read through refs so the trap is installed once: a fresh `onClose` per render
  // as a dependency would tear it down on every parent render and lose focus. A
  // stale `busy` would let Escape abandon a write in flight.
  const busyRef = useRef(busy);
  const onCloseRef = useRef(onClose);
  // Layout effect, so it flushes before the browser can dispatch another keydown that races a `busy` flip.
  useLayoutEffect(() => {
    busyRef.current = busy;
    onCloseRef.current = onClose;
  }, [busy, onClose]);

  // Read before the first commit: a field's `autoFocus` has moved focus by its effects.
  const [previouslyFocused] = useState(() => document.activeElement as HTMLElement | null);
  const focusWithinRef = useRef(focusWithin);

  useEffect(() => {
    const node = ref.current;
    // A focused field opens a phone's keyboard over the modal: there, focus stays on the modal itself.
    if (isPhone()) node?.focus();
    // The header's close button is the last resort, unless a field already took focus.
    else if (!node?.contains(document.activeElement)) {
      const first =
        focusWithinRef.current.map((r) => r.current?.querySelector<HTMLElement>(FOCUSABLE)).find(Boolean) ??
        node?.querySelector<HTMLElement>(FOCUSABLE);
      // The modal itself (tabIndex -1) when nothing inside can take focus, so it never escapes.
      (first ?? node)?.focus();
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busyRef.current) {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      } else if (e.shiftKey && (document.activeElement === firstItem || document.activeElement === node)) {
        e.preventDefault();
        lastItem.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [previouslyFocused]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center max-md:items-end">
      <div
        data-testid="dialog-backdrop"
        onClick={() => !busy && onClose()}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`${className} outline-none`}
      >
        {children}
      </div>
    </div>
  );
}
