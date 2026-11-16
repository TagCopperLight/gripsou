import { Check, Pencil } from "lucide-react";

import { ColorPicker } from "./ColorPicker";
import { usePopover } from "./usePopover";
import { safeBudgetColor } from "../lib/budget";
import { BUDGET_PALETTE } from "../lib/palette";

type ColorSwatchGridProps<C extends string | null> = {
  value: C;
  onChange: (color: C | string) => void;
  disabled?: boolean;
  /** Accessible name of a preset swatch. */
  swatchLabel: (color: string) => string;
  /** Accessible name of the free-pick swatch. */
  customLabel: string;
  /** Given, a "no colour" swatch ends the row (`onChange(null)`). */
  clearLabel?: string;
};

/** One row of preset swatches, then a swatch that opens our colour picker
 *  for anything off the palette. The row fills a form's width. */
export function ColorSwatchGrid<C extends string | null>({
  value, onChange, disabled = false, swatchLabel, customLabel, clearLabel,
}: ColorSwatchGridProps<C>) {
  const picker = usePopover();
  const open = picker.key !== null;
  // The picker swatch stands in for "a colour off the palette", so it only
  // reads as selected when the current colour is not one of the presets.
  const custom = value !== null && !BUDGET_PALETTE.includes(value);
  const swatch = "aspect-square w-full rounded-lg flex items-center justify-center cursor-pointer transition-transform duration-140";
  // The palette, the free pick and, when offered, the "no colour" swatch.
  const count = BUDGET_PALETTE.length + 1 + (clearLabel === undefined ? 0 : 1);

  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
      {BUDGET_PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          disabled={disabled}
          aria-label={swatchLabel(c)}
          aria-pressed={c === value}
          onClick={() => onChange(c)}
          className={`${swatch} ${c === value ? "ring-2 ring-fg" : "hover:scale-105"}`}
          style={{ background: c }}
        >
          {c === value && <Check className={`size-3.5 text-black/80`} />}
        </button>
      ))}
      <button
        type="button"
        disabled={disabled}
        aria-label={customLabel}
        aria-expanded={open}
        onClick={(e) => picker.toggle("open", e.currentTarget)}
        className={`${swatch} bg-surface-2 ${custom || open ? "ring-2 ring-fg" : "hover:scale-105"}`}
        style={{ background: custom ? safeBudgetColor(value) : undefined }}
      >
        <Pencil className={`size-3.5 ${custom ? "text-black/80" : "text-fg-faint"}`} />
      </button>
      {clearLabel !== undefined && (
        // "No colour" drawn as an empty square struck through, last, so the
        // colours sit at the same place in every picker, with or without it.
        <button
          type="button"
          disabled={disabled}
          aria-label={clearLabel}
          aria-pressed={value === null}
          onClick={() => onChange(null as C)}
          className={`${swatch} bg-surface-3 ${value === null ? "ring-2 ring-fg" : "hover:scale-105"}`}
        >
          <svg viewBox="0 0 12 12" aria-hidden className="size-full">
            <line x1="1.5" y1="10.5" x2="10.5" y2="1.5" stroke="currentColor" strokeWidth="1" className="text-fg-faint" />
          </svg>
        </button>
      )}
      {picker.anchor && (
        <ColorPicker
          value={value ?? "#000000"}
          onChange={onChange}
          anchor={picker.anchor}
          onClose={picker.close}
        />
      )}
    </div>
  );
}
