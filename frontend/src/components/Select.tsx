import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";

export type SelectOption = { value: string; label: string };

type SelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  className?: string;
};

export function Select({ value, onChange, options, className = "" }: SelectProps) {
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
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between bg-surface-2 rounded-xl px-4 py-3 text-fg text-[15px] cursor-pointer hover:bg-surface-3 transition-colors duration-140"
      >
        <span>{selected?.label ?? t("common.select")}</span>
        <ChevronDown
          className={`size-4 text-fg-faint transition-transform duration-140 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="absolute z-10 mt-1.5 w-full bg-surface-2 rounded-xl p-1 shadow-xl">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 rounded-lg text-[15px] cursor-pointer transition-colors duration-140 ${
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
