import type { Track } from "../../../ui/gridTable";

/** Column geometry shared by the header (`TransactionsTable`) and every row (`TransactionRow`).
 *  Only the amount track is content-derived: `max-content` over a floor wide enough for an
 *  ordinary six-figure amount, so only a bigger number moves it. */
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

/** Gutters between columns and the table's edges. Every cell pays for the gutter on its right
 *  (see `gridTable.ts`), so a truncated description cannot run into the date. */
export const COL_PAD = {
  transaction: "pl-3 pr-4",
  date: "pr-4",
  account: "pr-4",
  category: "pr-4",
  tags: "pr-4",
  checked: "pl-1 pr-4",
  amount: "pr-3",
};
