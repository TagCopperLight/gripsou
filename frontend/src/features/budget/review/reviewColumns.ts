/** The review line's row and fixed-width columns, shared by `ReviewLine` and
 *  `ReviewSkeleton` so the loading rows have the real rows' shape. Fixed widths
 *  line amounts, chips and buttons up down the list whatever the chip's label
 *  or whether a guess exists. */
export const REVIEW_ROW = "flex items-center gap-4 rounded-xl bg-surface-2 px-4 py-3";
export const AMOUNT_COL = "w-28 shrink-0";
export const CHIP_COL = "flex w-40 shrink-0";
export const CONFIDENCE_COL = "w-12 shrink-0";
