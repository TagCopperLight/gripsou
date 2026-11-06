import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

type ModalProps = {
  /** The dialog's accessible name. */
  label: string;
  onClose: () => void;
  busy?: boolean;
  /** The panel's size, shape and layout; the backdrop and centring are given. */
  className: string;
  /** Where focus lands on open, in order: the first control of the first of
   *  these that has one (the body, then the footer's actions), else the first
   *  control at all. A field with `autoFocus` overrides it. */
  focusWithin?: RefObject<HTMLElement | null>[];
  children: ReactNode;
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** What every modal shares: backdrop, scroll lock, a focus trap, Escape to
 *  close, and focus handed back to whatever was focused before it opened.
 *  Inert while `busy`, so a write in flight cannot be abandoned half-way.
 *  [`Dialog`](./Dialog.tsx) adds the standard header and footer; a modal with
 *  its own layout uses this directly. */
export function Modal({ label, onClose, busy = false, className, focusWithin = [], children }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  // `busy` and `onClose` are read through refs so the trap is installed once,
  // for the modal's whole life, and still sees the current values. Callers
  // pass a fresh `onClose` on every render; were it a dependency, every parent
  // re-render would tear the trap down, bounce focus to the element behind the
  // modal and back to the first field, and lose the user's place. A stale
  // `busy` would let Escape abandon a write in flight.
  const busyRef = useRef(busy);
  const onCloseRef = useRef(onClose);
  // A layout effect (not a passive one) so this flushes synchronously right
  // after commit, before the browser can dispatch another keydown/click —
  // closing the window where a real Escape could otherwise race a `busy`
  // flip and abandon a write in flight.
  useLayoutEffect(() => {
    busyRef.current = busy;
    onCloseRef.current = onClose;
  }, [busy, onClose]);

  // Read before the first commit: by its effects, a field's `autoFocus` has
  // already moved focus inside.
  const [previouslyFocused] = useState(() => document.activeElement as HTMLElement | null);
  const focusWithinRef = useRef(focusWithin);

  useEffect(() => {
    const node = ref.current;
    // Focus lands where the work starts (the header's close button is the
    // last resort, not the default), unless a field already took it.
    if (!node?.contains(document.activeElement)) {
      const first =
        focusWithinRef.current.map((r) => r.current?.querySelector<HTMLElement>(FOCUSABLE)).find(Boolean) ??
        node?.querySelector<HTMLElement>(FOCUSABLE);
      // Fall back to the modal itself (tabIndex -1) when nothing inside can
      // take focus, so focus never escapes to the page behind.
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
    <div className="fixed inset-0 z-50 flex items-center justify-center">
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
