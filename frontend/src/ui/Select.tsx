import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";

export type SelectOption = { value: string; label: string };

type SelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  className?: string;
  /** `sunken` is for a Select sitting on an already-lighter nested panel: the
   *  control goes one step darker so it still reads as a control. Its hover
   *  skips past the panel's own `surface-2` to `surface-3` — hovering onto the
   *  panel colour would make the control vanish into its background. Passed as
   *  a prop, not a caller class — two `bg-*` utilities of equal specificity
   *  resolve by stylesheet order, so a caller-supplied one would lose. */
  tone?: "default" | "sunken";
  /** Lets a `<label htmlFor>` name the control. */
  id?: string;
  disabled?: boolean;
};

/** Gap between the control and its menu, and the margin kept from the
 *  viewport edges. */
const GAP = 6;
const MARGIN = 8;

const TONES = {
  default: "bg-surface-2 hover:bg-surface-3",
  sunken: "bg-surface hover:bg-surface-3",
} as const;

export function Select({
  value, onChange, options, className = "", tone = "default", id, disabled = false,
}: SelectProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const selected = options.find((o) => o.value === value);

  // The menu is portalled and `fixed`, so a Select inside a scrolling or
  // clipped container (a Dialog) can open past that container's edge instead
  // of growing it. Measured after layout, and again on any scroll or resize,
  // so it follows the control; flipped above only when it does not fit below
  // and there is more room above.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = ref.current?.getBoundingClientRect();
      const menu = menuRef.current?.getBoundingClientRect();
      if (!rect || !menu) return;
      const vh = window.innerHeight;
      const below = rect.bottom + GAP;
      const fitsBelow = below + menu.height <= vh - MARGIN;
      const top = fitsBelow || rect.top < vh - rect.bottom
        ? below
        : Math.max(MARGIN, rect.top - GAP - menu.height);
      setPos({ top, left: rect.left, width: rect.width });
    };
    place();
    // Capture phase: the scroll that moves the control is usually on an inner
    // container, and those do not bubble.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  // Close when clicking outside the control and its menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center justify-between gap-2 ${TONES[tone]} rounded-xl px-3.5 py-2.25 text-fg text-sm cursor-pointer transition-colors duration-140 disabled:opacity-60 disabled:cursor-not-allowed`}
      >
        <span title={selected?.label} className="min-w-0 truncate">{selected?.label ?? t("common.select")}</span>
        <ChevronDown
          className={`size-4 shrink-0 text-fg-faint transition-transform duration-140 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && !disabled && createPortal(
        <div
          ref={menuRef}
          // Hidden until measured, so the first paint is never at the wrong place.
          style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, width: pos?.width, visibility: pos ? "visible" : "hidden" }}
          className={`fixed z-60 max-h-80 overflow-y-auto rounded-xl p-1 shadow-xl ${
            tone === "sunken" ? "bg-surface" : "bg-surface-2"
          }`}
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              title={o.label}
              className={`w-full truncate text-left px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors duration-140 ${
                o.value === value
                  ? "bg-surface-3 text-fg"
                  : "text-fg-dim hover:bg-surface-3 hover:text-fg"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
