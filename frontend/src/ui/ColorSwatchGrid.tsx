import { useState } from "react";
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
  /** `grid` fills a form's width; `inline` is a row of small squares that
   *  sits on a list line. */
  size?: "grid" | "inline";
  /** Given, a "no colour" swatch leads the row (`onChange(null)`). */
  clearLabel?: string;
  /** False when every change is a write: the picker then previews here while
   *  it is dragged (it reports every step) and changes the value once, when it
   *  closes. */
  live?: boolean;
};

const SIZES = {
  grid: { row: "grid grid-cols-[repeat(18,minmax(0,1fr))] gap-2", swatch: "aspect-square w-full rounded-lg", icon: "size-3.5" },
  inline: { row: "flex items-center gap-1", swatch: "size-4.5 rounded-md", icon: "size-3" },
} as const;

/** One row of preset swatches, then a swatch that opens our colour picker
 *  for anything off the palette. */
export function ColorSwatchGrid<C extends string | null>({
  value, onChange, disabled = false, swatchLabel, customLabel, size = "grid", clearLabel, live = true,
}: ColorSwatchGridProps<C>) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  const picker = usePopover(() => {
    setDraft(null);
    if (draft !== null && draft.toLowerCase() !== value?.toLowerCase()) onChange(draft);
  });
  const open = picker.key !== null;
  // The picker swatch stands in for "a colour off the palette", so it only
  // reads as selected when the current colour is not one of the presets.
  const custom = shown !== null && !BUDGET_PALETTE.includes(shown);
  const s = SIZES[size];
  const swatch = `${s.swatch} flex items-center justify-center cursor-pointer transition-transform duration-140 disabled:opacity-40 disabled:cursor-not-allowed`;

  return (
    <div className={s.row}>
      {clearLabel !== undefined && (
        // "No colour" drawn as an empty square struck through: the absence of
        // a colour still needs a swatch to sit in, otherwise the colours
        // start at a different x on every row.
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
          {c === value && <Check className={`${s.icon} text-black/80`} />}
        </button>
      ))}
      <button
        type="button"
        disabled={disabled}
        aria-label={customLabel}
        aria-expanded={open}
        onClick={(e) => picker.toggle("open", e.currentTarget)}
        className={`${swatch} bg-surface-2 ${custom || open ? "ring-2 ring-fg" : "hover:scale-105"}`}
        style={{ background: custom ? safeBudgetColor(shown) : undefined }}
      >
        <Pencil className={`${s.icon} ${custom ? "text-black/80" : "text-fg-faint"}`} />
      </button>
      {picker.anchor && (
        <ColorPicker
          value={shown ?? "#000000"}
          onChange={live ? onChange : setDraft}
          anchor={picker.anchor}
          onClose={picker.close}
        />
      )}
    </div>
  );
}
