// Text widths (in percent of a text column), varied so loading rows read as
// text, not as bars.
const WIDTHS = [46, 34, 52, 40];

/** The widths of a loading list's rows, one per row. `rows` is the list's
 *  usual length, so the list moves as little as possible when it arrives. */
export function boneWidths(rows: number): number[] {
  return WIDTHS.slice(0, rows);
}
