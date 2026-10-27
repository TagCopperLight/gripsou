import { useState } from "react";
import { Check, Pencil } from "lucide-react";

import { ColorPicker } from "./ColorPicker";

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

/** One row of preset swatches, then a swatch that opens our colour picker
 *  for anything off the palette. */
export function ColorSwatchGrid({ value, onChange, disabled = false, swatchLabel, customLabel }: ColorSwatchGridProps) {
  // The picker swatch stands in for "a colour off the palette", so it only
  // reads as selected when the current colour is not one of the presets.
  const custom = !BUDGET_PALETTE.includes(value);
  const previewColor = safeBudgetColor(value);
  // The pencil swatch while the picker hangs under it, null while it is closed.
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const open = anchor !== null;

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
      <button
        type="button"
        disabled={disabled}
        aria-label={customLabel}
        aria-expanded={open}
        onClick={(e) => setAnchor(open ? null : e.currentTarget)}
        className={`aspect-square w-full rounded-lg bg-surface-2 flex items-center justify-center cursor-pointer transition-transform duration-140 disabled:opacity-40 disabled:cursor-not-allowed ${
          custom || open ? "ring-2 ring-fg" : "hover:scale-105"
        }`}
        style={{ background: custom ? previewColor : undefined }}
      >
        <Pencil className={`size-3.5 ${custom ? "text-black/80" : "text-fg-faint"}`} />
      </button>
      {anchor && (
        <ColorPicker value={value} onChange={onChange} anchor={anchor} onClose={() => setAnchor(null)} />
      )}
    </div>
  );
}
