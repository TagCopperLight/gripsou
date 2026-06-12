import { useState, type ReactNode } from "react";

export type SegmentedOption<T extends string> = {
  value: T;
  label: ReactNode;
};

type SegmentedControlProps<T extends string> = {
  options: SegmentedOption<T>[];
  /** Initial selection. Falls back to the first option — there is always one selected. */
  defaultValue?: T;
  /** Pass to make the control controlled; the parent then owns selection. */
  value?: T;
  onChange?: (value: T) => void;
  className?: string;
};

export function SegmentedControl<T extends string>({
  options,
  defaultValue,
  value,
  onChange,
  className = "",
}: SegmentedControlProps<T>) {
  const [internal, setInternal] = useState<T>(defaultValue ?? options[0].value);
  const selected = value ?? internal;

  const select = (next: T) => {
    if (value === undefined) setInternal(next);
    onChange?.(next);
  };

  return (
    <div
      role="radiogroup"
      className={`font-mono inline-flex gap-0.5 p-0.75 rounded-xl bg-surface-2 ${className}`}
    >
      {options.map((option) => {
        const isSelected = option.value === selected;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => select(option.value)}
            className={`px-2.5 py-1 rounded-lg text-[12.5px] font-medium cursor-pointer transition-colors duration-140 ${
              isSelected
                ? "bg-surface-3 text-fg"
                : "text-fg-faint hover:text-fg-dim"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
