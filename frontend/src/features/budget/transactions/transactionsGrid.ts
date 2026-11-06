import type { Track } from "../../../ui/gridTable";

/** Column geometry for the transactions table, shared by the header
 *  (`TransactionsTable`) and every row (`TransactionRow`) so the two can never
 *  drift apart.
 *
 *  Reading the tracks, left to right:
 *  - **transaction**: the avatar and the name live in the same cell (fixed
 *    distance apart), so this track is both. It grows: `3fr` of the surplus.
 *  - **date**: fixed. Every formatted date is about the same width.
 *  - **account**, **category**: they truncate rather than letting one long
 *    name eat the space the description wants.
 *  - **tags**: grows too, at `2fr`, so the surplus splits 3:2 with the name.
 *    `TagCell` counts off whatever no longer fits.
 *  - **✓**: fixed and narrow; present only when the preference is on.
 *  - **amount**: `max-content`, so it is never truncated or wrapped, over a
 *    floor wide enough for an ordinary six-figure amount. The floor is what
 *    keeps it still: only a genuinely bigger number moves it.
 *
 *  Nothing here is content-derived except that last track, so filtering cannot
 *  reshuffle the columns.
 */
const TRACKS = {
  transaction: { min: "220px", max: "3fr" },
  // 95px for the text plus the 16px gutter to its right.
  date: { min: "111px" },
  account: { min: "110px", max: "180px" },
  category: { min: "110px", max: "170px" },
  tags: { min: "80px", max: "2fr" },
  // 36px for the box, plus the 16px gutter its padding pays for.
  checked: { min: "52px" },
  amount: { min: "7rem", max: "max-content" },
} satisfies Record<string, Track>;

export function gridTracks(showChecked: boolean): Track[] {
  return [
    TRACKS.transaction,
    TRACKS.date,
    TRACKS.account,
    TRACKS.category,
    TRACKS.tags,
    ...(showChecked ? [TRACKS.checked] : []),
    TRACKS.amount,
  ];
}

/** Horizontal padding per column: the gutters between columns, and the
 *  table's own left and right edges. Every cell pays for the gutter on its
 *  right (see `gridTable.ts`), which is also what stops a truncated
 *  description from running its ellipsis into the date. */
export const COL_PAD = {
  transaction: "pl-3 pr-4",
  date: "pr-4",
  account: "pr-4",
  category: "pr-4",
  tags: "pr-4",
  checked: "pl-1 pr-4",
  amount: "pr-3",
};
