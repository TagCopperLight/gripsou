/** Classes shared by every grid table (`GridTable`): the transactions list,
 *  the holdings card. A grid table is a CSS grid, not a table layout, so its
 *  columns are tracks a caller defines once (`minmax(110px, 180px)`, `3fr`)
 *  and the header and every row sit on them through `grid-cols-subgrid`:
 *  filtering or searching never reshuffles the columns.
 *
 *  Columns are spaced by padding on each cell (the gutter on its right),
 *  never by a grid `column-gap`: the hover fill is painted by the cells
 *  themselves, so a real gap would slice it into stripes.
 */

/** Everything a row's cells share, applied from the `<tr>`.
 *
 *  The background lives on the cells, not on the `<tr>`: only a cell can round
 *  a corner, so the first and last one carry the row's rounded ends.
 *
 *  Each cell is a grid item on the table's tracks, so it stretches to the
 *  row's height; `flex items-center` is what centres the content inside it.
 *
 *  Vertical geometry, top to bottom: a 1px transparent top border, the
 *  rectangle, then a 2px transparent bottom border. `bg-clip-padding` keeps
 *  the hover fill off those borders, so each rectangle stops 1px short of its
 *  neighbours; `::after` draws the separator into the middle of the resulting
 *  3px band: 1px gap, 1px rule, 1px gap.
 *
 *  Horizontally the rule is flush with the text, not with the row: the end
 *  cells pull it in by their own edge padding. The hover rectangle still goes
 *  full-bleed underneath; only the separator is inset.
 */
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

/** The hover fill of a row that does something when clicked or hovered. */
export const ROW_HOVER = "hover:[&>td]:bg-hover";

/** The header row: 11px uppercase mono, faint, wide-tracked, the same head
 *  treatment as every table in the app. */
export const HEAD_ROW =
  "col-span-full grid grid-cols-subgrid text-left text-[11px] font-mono uppercase tracking-wide text-fg-faint";

/** A header cell; add the column's padding and alignment. */
export const HEAD_CELL = "flex items-center py-2 font-medium";
