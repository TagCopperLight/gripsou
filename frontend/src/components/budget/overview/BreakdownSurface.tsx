import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react";

import { Surface } from "../../Surface";
import { GridTable } from "../../GridTable";
import { HEAD_CELL, ROW_CELLS, ROW_HOVER } from "../../gridTable";
import { MaskedMoney } from "../../PrivateMoney";
import { Percent } from "../../Percent";
import { CategoryChip } from "../CategoryChip";
import { sliceChip, sliceColor, sliceKey, sliceLabel } from "../../../lib/slice";
import { TONE_CLASS, compareToBaseline } from "../../../lib/comparison";
import type { BreakdownRow, Slice } from "../../../api/overview";

type SortKey = "category" | "amount" | "txnCount";
type ColKey = SortKey | "share" | "avg12";

type BreakdownSurfaceProps = {
  rows: BreakdownRow[];
  /** The period's total expenses (the expenses figure), so SHARE is
   *  arithmetic here rather than a second server opinion that could round
   *  differently from the column beside it. */
  expensesTotal: string;
  /** A row was clicked: open Transactions filtered to the period AND this
   *  slice. Never called for the `other` row. */
  onOpen: (slice: Slice) => void;
  /** Private mode: amounts hidden, shares and percentages kept. */
  masked?: boolean;
};

export function BreakdownSurface({ rows, expensesTotal, onOpen, masked = false }: BreakdownSurfaceProps) {
  const { t } = useTranslation();
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "amount", asc: false });

  const total = Number(expensesTotal);

  // Same behaviour as the holdings table: a new column starts in its natural
  // direction (A→Z for names, largest first for figures), a second click flips.
  const toggle = (key: SortKey) =>
    setSort((prev) =>
      prev.key === key ? { key, asc: !prev.asc } : { key, asc: key === "category" },
    );

  // `other` is a rollup, not a peer: it stays pinned last however the real rows
  // are ordered, so the table always reads "…and everything else".
  const real = rows.filter((r) => r.slice.kind !== "other");
  const rollup = rows.filter((r) => r.slice.kind === "other");

  const sorted = [...real].sort((a, b) => {
    const dir = sort.asc ? 1 : -1;
    switch (sort.key) {
      case "category":
        // `sliceLabel`, not `sliceChip(...)?.name`: the chip's own name falls
        // back to "" for uncategorised, which would sort it before every real
        // category instead of alongside them by its displayed label.
        return dir * sliceLabel(t, a.slice).localeCompare(sliceLabel(t, b.slice));
      case "txnCount":
        return dir * (a.txnCount - b.txnCount);
      default:
        return dir * (Number(a.amount) - Number(b.amount));
    }
  });

  // On the shared grid table (`gridTable.ts`), like Holdings and Transactions:
  // CATEGORY and SHARE grow, the figures have floors, so sorting never moves a
  // column. SHARE orders exactly like AMOUNT and the 12-month column is a ratio
  // with gaps, so neither sorts. The last track holds the row's caret.
  const columns: { key: ColKey; labelKey: string; right: boolean; track: string; pad: string; sort?: SortKey }[] = [
    { key: "category", labelKey: "category", right: false, track: "minmax(180px, 2fr)", pad: "pl-3 pr-4", sort: "category" },
    { key: "amount", labelKey: "amount", right: true, track: "minmax(7rem, max-content)", pad: "pr-4", sort: "amount" },
    { key: "share", labelKey: "share", right: false, track: "minmax(140px, 3fr)", pad: "pr-4" },
    { key: "txnCount", labelKey: "txnCount", right: true, track: "minmax(4rem, max-content)", pad: "pr-10", sort: "txnCount" },
    { key: "avg12", labelKey: "vsAvg12", right: true, track: "minmax(5rem, max-content)", pad: "pr-2" },
  ];
  const tracks = [...columns.map((c) => c.track), "2.25rem"].join(" ");
  const pad = Object.fromEntries(columns.map((c) => [c.key, c.pad])) as Record<ColKey, string>;

  return (
    <Surface className="w-full">
      <div className="flex flex-col p-5">
        <h2 className="text-fg font-semibold text-sm">{t("budget.overview.breakdown.title")}</h2>
        <div className="mt-3">
          <GridTable
            columns={tracks}
            minWidth="37.5rem"
            head={
              <>
                {columns.map((c) => {
                  const active = c.sort !== undefined && sort.key === c.sort;
                  return (
                    <th
                      key={c.key}
                      role="columnheader"
                      className={`${HEAD_CELL} whitespace-nowrap ${c.pad} ${c.right ? "justify-end" : ""}`}
                    >
                      {c.sort ? (
                        <button
                          type="button"
                          data-testid={`sort-${c.sort}`}
                          onClick={() => toggle(c.sort!)}
                          // `uppercase` on the button itself: the browser's own
                          // button style resets `text-transform`, so it is not
                          // inherited from the row.
                          className={`inline-flex h-4 cursor-pointer items-center gap-1 align-middle uppercase transition-colors duration-140 ${
                            c.right ? "flex-row-reverse" : ""
                          } ${active ? "text-fg" : "text-fg-dim hover:text-fg"}`}
                        >
                          {t(`budget.overview.breakdown.${c.labelKey}`)}
                          {active &&
                            (sort.asc ? (
                              <ChevronUp className="size-3.5" />
                            ) : (
                              <ChevronDown className="size-3.5" />
                            ))}
                        </button>
                      ) : (
                        <span className="inline-flex h-4 items-center align-middle">
                          {t(`budget.overview.breakdown.${c.labelKey}`)}
                        </span>
                      )}
                    </th>
                  );
                })}
                <th role="columnheader" />
              </>
            }
          >
            {[...sorted, ...rollup].map((row) => {
              const linkable = row.slice.kind !== "other";
              const share = total === 0 ? 0 : Number(row.amount) / total;
              // Absent on `other`, whose membership changes month to month.
              const vsAvg =
                row.avg12 === undefined ? undefined : compareToBaseline(row.amount, row.avg12, "down");
              return (
                <tr
                  key={sliceKey(row.slice)}
                  role="row"
                  data-testid={`breakdown-row-${sliceKey(row.slice)}`}
                  onClick={() => linkable && onOpen(row.slice)}
                  className={`${ROW_CELLS} ${linkable ? `cursor-pointer ${ROW_HOVER}` : ""}`}
                >
                  <td role="cell" className={`py-2 ${pad.category}`}>
                    <div className="min-w-0">
                      <CategoryChip category={sliceChip(t, row.slice)} />
                    </div>
                  </td>
                  <td role="cell" className={`justify-end whitespace-nowrap ${pad.amount}`}>
                    <MaskedMoney masked={masked} value={row.amount} className="text-sm text-fg" />
                  </td>
                  <td role="cell" className={pad.share}>
                    <span className="flex w-full items-center gap-4">
                      <span className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-fg/10">
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: `${Math.min(100, share * 100)}%`,
                            background: sliceColor(row.slice),
                          }}
                        />
                      </span>
                      {/* fractionDigits=1, not 0: at 0 decimals, 61.86%
                       *  rounds to "62%" and the "computes share" test
                       *  (which checks for "61") fails. One decimal keeps
                       *  the label compact and independent of the user's
                       *  percentDecimals pref while matching the brief's
                       *  own worked example (61,9 %). */}
                      <span data-testid="share" className="text-xs text-fg-faint">
                        <Percent value={share} fractionDigits={1} />
                      </span>
                    </span>
                  </td>
                  <td role="cell" className={`justify-end ${pad.txnCount}`} data-testid="txnCount">
                    <span className="text-sm text-fg-dim">{row.txnCount}</span>
                  </td>
                  <td role="cell" className={`justify-end whitespace-nowrap ${pad.avg12}`} data-testid="avg12">
                    {vsAvg === undefined ? (
                      <span className="text-sm text-fg-faint">—</span>
                    ) : (
                      <span data-tone={vsAvg.tone} className={`text-sm ${TONE_CLASS[vsAvg.tone]}`}>
                        {/* Same rule as the figures above: against a zero
                            average the change is an amount, not a percentage. */}
                        {vsAvg.ratio === undefined ? (
                          <MaskedMoney masked={masked} value={vsAvg.delta} signed />
                        ) : (
                          <Percent value={vsAvg.ratio} signed />
                        )}
                      </span>
                    )}
                  </td>
                  <td role="cell" className="justify-end pr-3">
                    {linkable && (
                      <button
                        type="button"
                        data-testid="row-caret"
                        aria-label={t("budget.overview.breakdown.open")}
                        // The row itself is a click target but not focusable:
                        // this button is the keyboard way in. Stopping propagation here keeps `onOpen` firing
                        // exactly once instead of twice per click.
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpen(row.slice);
                        }}
                        className="ml-auto flex cursor-pointer items-center justify-end"
                      >
                        <ChevronRight className="size-4 text-fg-faint" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </GridTable>
        </div>
      </div>
    </Surface>
  );
}
