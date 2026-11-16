// Varied, so loading rows read as text, not bars.
const WIDTHS = [46, 34, 52, 40];

/** `rows` is the list's usual length, so it moves little when it arrives. */
export function boneWidths(rows: number): number[] {
  return WIDTHS.slice(0, rows);
}
