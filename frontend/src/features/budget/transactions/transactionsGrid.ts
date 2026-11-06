/** Column geometry for the transactions table, shared by the header
 *  (`TransactionsTable`) and every row (`TransactionRow`) so the two can never
 *  drift apart.
 *
 *  The table is a CSS grid, not a table layout: `table-fixed` percentages could
 *  say "a sixth of the width" but not "at least 110px, at most 200px, then take
 *  a share of whatever is left", which is what these columns actually want.
 *  `display: contents` on the groups and `grid-cols-subgrid` on each row put
 *  every cell on this one set of tracks.
 *
 *  Reading the tracks, left to right:
 *  - **transaction** — the avatar and the name live in the same cell (fixed
 *    distance apart), so this track is both. It grows: `3fr` of the surplus.
 *  - **date** — fixed. Every formatted date is about the same width, and the
 *    old 10% left a canyon before the account.
 *  - **account**, **category** — `minmax(min, max)`: they truncate rather than
 *    letting one long name eat the space the description wants.
 *  - **tags** — grows too, at `2fr`, so the surplus splits 3:2 with the name.
 *    `TagCell` counts off whatever no longer fits.
 *  - **✓** — fixed and narrow; present only when the preference is on.
 *  - **amount** — `max-content`, so it is never truncated or wrapped, over a
 *    floor wide enough for an ordinary six-figure amount. The floor is what
 *    keeps it still: only a genuinely bigger number moves it.
 *
 *  Nothing here is content-derived except that last track, so filtering cannot
 *  reshuffle the columns.
 */
const TRACKS = {
  transaction: "minmax(220px, 3fr)",
  // 95px for the text plus the 16px gutter to its right.
  date: "111px",
  account: "minmax(110px, 180px)",
  category: "minmax(110px, 170px)",
  tags: "minmax(80px, 2fr)",
  // 36px for the box, plus the 16px gutter its padding pays for.
  checked: "52px",
  amount: "minmax(7rem, max-content)",
};

export function gridTemplate(showChecked: boolean): string {
  return [
    TRACKS.transaction,
    TRACKS.date,
    TRACKS.account,
    TRACKS.category,
    TRACKS.tags,
    ...(showChecked ? [TRACKS.checked] : []),
    TRACKS.amount,
  ].join(" ");
}

/** The sum of the minimums. Below this the grid would rather overflow than
 *  shrink a column past its floor, so the table scrolls sideways instead. */
export const MIN_TABLE_WIDTH = "48rem";

/** Horizontal padding per column — the gutters between columns, and the
 *  table's own left and right edges.
 *
 *  It has to be padding rather than a grid `column-gap`: the hover and
 *  selection rectangles are painted by the cells themselves, so a real gap
 *  would slice each row's fill into stripes. Every cell therefore pays for the
 *  gutter on its right, which is also what stops a truncated description from
 *  running its ellipsis into the date.
 */
export const COL_PAD = {
  transaction: "pl-3 pr-4",
  date: "pr-4",
  account: "pr-4",
  category: "pr-4",
  tags: "pr-4",
  checked: "pl-1 pr-4",
  amount: "pr-3",
};
