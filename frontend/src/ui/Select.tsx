import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";

import { FloatingPanel } from "./FloatingPanel";
import { usePopover } from "./usePopover";

export type SelectOption = { value: string; label: string };

type SelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  className?: string;
  /** For a Select on a lighter nested panel. A prop, not a caller class: equal-specificity `bg-*` utilities resolve by stylesheet order. */
  tone?: "default" | "sunken";
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
  const menu = usePopover();
  const open = menu.key !== null;
  const selected = options.find((o) => o.value === value);

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={(e) => menu.toggle("open", e.currentTarget)}
        className={`w-full flex items-center justify-between gap-2 ${TONES[tone]} rounded-xl px-3.5 py-2.25 text-fg text-sm cursor-pointer transition-colors duration-140 disabled:opacity-60`}
      >
        <span title={selected?.label} className="min-w-0 truncate">{selected?.label ?? t("common.select")}</span>
        <ChevronDown
          className={`size-4 shrink-0 text-fg-faint transition-transform duration-140 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && !disabled && (
        <FloatingPanel
          anchor={menu.anchor}
          onClose={menu.close}
          align="match"
          className={`max-h-80 overflow-y-auto rounded-xl p-1 shadow-xl ${tone === "sunken" ? "bg-surface" : "bg-surface-2"}`}
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value);
                menu.close();
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
        </FloatingPanel>
      )}
    </div>
  );
}
