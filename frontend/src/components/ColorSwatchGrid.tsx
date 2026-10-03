import { Check, Pencil } from "lucide-react";

import { BUDGET_PALETTE, safeBudgetColor } from "../lib/budget";

type ColorSwatchGridProps = {
  value: string;
  onChange: (color: string) => void;
  disabled?: boolean;
  /** Accessible name of a preset swatch. */
  swatchLabel: (color: string) => string;
  /** Accessible name of the free-pick swatch. */
  customLabel: string;
};

/** One row of preset swatches, then a swatch that opens the native colour
 *  picker for anything off the palette. */
export function ColorSwatchGrid({ value, onChange, disabled = false, swatchLabel, customLabel }: ColorSwatchGridProps) {
  // The picker swatch stands in for "a colour off the palette", so it only
  // reads as selected when the current colour is not one of the presets.
  const custom = !BUDGET_PALETTE.includes(value);
  const previewColor = safeBudgetColor(value);

  return (
    <div className="grid grid-cols-[repeat(18,minmax(0,1fr))] gap-2">
      {BUDGET_PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          disabled={disabled}
          aria-label={swatchLabel(c)}
          aria-pressed={c === value}
          onClick={() => onChange(c)}
          className={`aspect-square w-full rounded-lg flex items-center justify-center cursor-pointer transition-transform duration-140 disabled:opacity-40 ${
            c === value ? "ring-2 ring-fg" : "hover:scale-105"
          }`}
          style={{ background: c }}
        >
          {c === value && <Check className="size-3.5 text-black/80" />}
        </button>
      ))}
      {/* The native colour input has its own intrinsic height, so it is
          stretched invisibly over a square of our own rather than being
          sized directly — that is what keeps it on the swatch grid. */}
      <label
        className={`relative aspect-square w-full rounded-lg bg-surface-2 flex items-center justify-center cursor-pointer transition-transform duration-140 ${
          custom ? "ring-2 ring-fg" : "hover:scale-105"
        } ${disabled ? "opacity-40" : ""}`}
        style={{ background: custom ? previewColor : undefined }}
      >
        <span className="sr-only">{customLabel}</span>
        <Pencil className={`size-3.5 ${custom ? "text-black/80" : "text-fg-faint"}`} />
        <input
          type="color"
          aria-label={customLabel}
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 size-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
        />
      </label>
    </div>
  );
}
