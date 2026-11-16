/** Shared by `ReviewLine` and `ReviewSkeleton`. Fixed widths line up amounts, chips and buttons whatever the chip's label or whether a guess exists.
 *  On a phone a row stacks: description and amount, then the guess, its confidence and the two buttons. */
export const REVIEW_ROW =
  "flex items-center gap-4 rounded-xl bg-surface-2 px-4 py-3 max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto_auto] max-md:gap-x-3 max-md:gap-y-3 max-md:py-3.5";
export const AVATAR_COL = "max-md:hidden";
export const TEXT_COL = "min-w-0 flex-1 max-md:col-span-2";
export const AMOUNT_COL = "w-28 shrink-0 max-md:w-auto max-md:self-start max-md:justify-self-end";
/** Holds the guess and its confidence together on a phone; on a desktop they stay columns of the row. */
export const GUESS_GROUP = "flex min-w-0 items-center gap-3 md:contents";
export const CHIP_COL = "flex w-40 shrink-0 max-md:w-auto max-md:min-w-0 max-md:shrink";
export const CONFIDENCE_COL = "w-12 shrink-0 max-md:w-auto max-md:text-xs";
const PHONE_PILL = "max-md:rounded-lg max-md:px-3 max-md:py-1.5 max-md:text-xs";
export const ACCEPT_BUTTON = `${PHONE_PILL} max-md:bg-green/15 max-md:text-green`;
export const CORRECT_BUTTON = `${PHONE_PILL} max-md:bg-surface-3`;
