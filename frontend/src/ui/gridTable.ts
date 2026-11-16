/** A CSS grid, not a table layout: callers define the column tracks once and the
 *  header and rows sit on them through `grid-cols-subgrid`, so filtering never
 *  reshuffles columns. Columns are spaced by cell padding, never `column-gap`:
 *  cells paint the hover fill, so a real gap would slice it into stripes. */

/** Applied from the `<tr>`. The background lives on the cells because only a cell
 *  can round a corner. Cells stretch to the row height, so `flex items-center`
 *  centres the content.
 *
 *  Vertical: a 1px transparent top border, the rectangle, a 2px transparent
 *  bottom border. `bg-clip-padding` keeps the hover fill off the borders, and
 *  `::after` draws the separator in the resulting 3px band (1px gap, 1px rule,
 *  1px gap). Horizontally the rule is flush with the text: end cells pull it in
 *  by their edge padding while the hover rectangle stays full-bleed. */
export const ROW_CELLS = [
  "col-span-full grid grid-cols-subgrid",
  "[&>td]:flex [&>td]:items-center [&>td]:min-w-0",
  "[&>td]:relative [&>td]:border-y [&>td]:border-b-2 [&>td]:border-transparent [&>td]:bg-clip-padding",
  "[&>td]:after:content-[''] [&>td]:after:absolute [&>td]:after:inset-x-0",
  "[&>td]:after:-top-0.5 [&>td]:after:h-px [&>td]:after:bg-surface-2",
  "[&>td]:transition-colors [&>td]:duration-140",
  "[&>td:first-child]:after:left-3 [&>td:last-child]:after:right-3",
  "[&>td:first-child]:rounded-l-xl [&>td:last-child]:rounded-r-xl",
].join(" ");

export const ROW_HOVER = "hover:[&>td]:bg-hover";

/** At least `min`, growing to `max` (a length, `Nfr`, `max-content`, `auto`). */
export type Track = { min: string; max?: string };

export function gridColumns(tracks: Track[]): { template: string; minWidth: string } {
  return {
    template: tracks.map((t) => (t.max ? `minmax(${t.min}, ${t.max})` : t.min)).join(" "),
    minWidth: `calc(${tracks.map((t) => t.min).join(" + ")})`,
  };
}

export const HEAD_TEXT = "font-mono text-[11px] font-medium tracking-wide text-fg-faint";

export const HEAD_ROW = `col-span-full grid grid-cols-subgrid text-left uppercase ${HEAD_TEXT}`;

export const HEAD_CELL = "flex items-center py-2 font-medium";
