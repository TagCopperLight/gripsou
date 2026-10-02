import { useEffect, useRef, useState } from "react";
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
  const selected = options.find((o) => o.value === value);

  // Close when clicking outside the control.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
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
      {open && !disabled && (
        <div
          className={`absolute z-10 mt-1.5 w-full rounded-xl p-1 shadow-xl ${
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
        </div>
      )}
    </div>
  );
}
