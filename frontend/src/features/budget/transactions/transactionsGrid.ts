import { PHONE_HIDDEN, type Track } from "../../../ui/gridTable";

/** Column geometry shared by the header (`TransactionsTable`) and every row (`TransactionRow`).
 *  Only the amount track is content-derived: `max-content` over a floor wide enough for an
 *  ordinary six-figure amount, so only a bigger number moves it. */
/** A phone keeps the description and the amount; the category goes under the description and the date under the amount. */
const TRACKS = {
  transaction: { min: "220px", max: "3fr", phone: { min: "0px", max: "1fr" } },
  // 95px for the text plus the 16px gutter to its right.
  date: { min: "111px", phone: null },
  account: { min: "110px", max: "180px", phone: null },
  category: { min: "110px", max: "170px", phone: null },
  tags: { min: "80px", max: "2fr", phone: null },
  // 36px for the box, plus the 16px gutter its padding pays for.
  checked: { min: "52px", phone: null },
  amount: { min: "7rem", max: "max-content", phone: { min: "max-content" } },
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
  transaction: "pl-3 pr-4 max-md:pr-3",
  date: `pr-4 ${PHONE_HIDDEN}`,
  account: `pr-4 ${PHONE_HIDDEN}`,
  category: `pr-4 ${PHONE_HIDDEN}`,
  tags: `pr-4 ${PHONE_HIDDEN}`,
  checked: `pl-1 pr-4 ${PHONE_HIDDEN}`,
  amount: "pr-3",
};
