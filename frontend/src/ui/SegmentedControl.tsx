import type { ReactNode } from "react";

export type SegmentedOption<T extends string> = {
  value: T;
  label: ReactNode;
  /** An attention state, not a selection state (Budget's amber Review segment). */
  className?: string;
};

type SegmentedControlProps<T extends string> = {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className = "",
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      className={`font-mono inline-flex gap-0.5 p-0.75 rounded-xl bg-surface-2 ${className}`}
    >
      {options.map((option) => {
        const isSelected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onChange(option.value)}
            className={`px-2.5 py-1 rounded-lg text-[12.5px] font-medium cursor-pointer transition-colors duration-140 ${
              isSelected
                ? "bg-surface-3 text-fg"
                : `text-fg-faint enabled:hover:text-fg-dim ${option.className ?? ""}`
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
