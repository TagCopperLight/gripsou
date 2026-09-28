import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

type DialogProps = {
  title: string;
  /** Visible heading when it differs from the accessible name — e.g. a live
      preview of what the user is typing, which must not rename the dialog. */
  heading?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  icon?: ReactNode;
  busy?: boolean;
  large?: boolean;
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The app's modal: backdrop, scroll lock, a focus trap, Escape to close, and
 *  focus handed back to whatever was focused before it opened. Inert while
 *  `busy`, so a write in flight cannot be abandoned half-way. */
export function Dialog({
  title, heading, onClose, children, footer, icon, busy = false, large = false,
}: DialogProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  // `busy` and `onClose` are read through refs so the trap is installed once,
  // for the dialog's whole life, and still sees the current values. Callers
  // pass a fresh `onClose` on every render; were it a dependency, every parent
  // re-render would tear the trap down, bounce focus to the element behind the
  // dialog and back to the first field, and lose the user's place. A stale
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

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const node = ref.current;
    // Focus lands where the work starts: the first field of the body, else the
    // first footer action (a confirmation's Cancel), and only then anything
    // at all — the header's close button is the last resort, not the default.
    const first =
      node?.querySelector<HTMLElement>("[data-autofocus]") ??
      bodyRef.current?.querySelector<HTMLElement>(FOCUSABLE) ??
      footerRef.current?.querySelector<HTMLElement>(FOCUSABLE) ??
      node?.querySelector<HTMLElement>(FOCUSABLE);
    // Fall back to the dialog itself (tabIndex -1) when nothing inside can take
    // focus, so focus never escapes to the page behind.
    (first ?? node)?.focus();

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
  }, []);

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
        aria-label={title}
        className={`relative ${large ? "w-160" : "w-120"} max-w-[90vw] max-h-[90vh] overflow-y-auto bg-surface rounded-3xl flex flex-col outline-none`}
      >
        <div className="flex items-center justify-between px-6 pt-6 pb-2">
          <h2 className="flex items-center gap-2.5 text-xl font-semibold text-fg">
            {icon}
            {heading ?? title}
          </h2>
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
        <div ref={bodyRef} className="px-6 py-4">{children}</div>
        {footer && (
          <div ref={footerRef} className="flex items-center justify-end gap-2 px-6 pb-6 pt-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
