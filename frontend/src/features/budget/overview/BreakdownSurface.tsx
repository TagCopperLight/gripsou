import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";

import { Surface } from "../../../ui/Surface";
import { GridTable, SortHeader } from "../../../ui/GridTable";
import { HEAD_CELL, ROW_CELLS, ROW_HOVER, type Track } from "../../../ui/gridTable";
import { MaskedMoney } from "../../../ui/MaskedMoney";
import { Percent } from "../../../ui/Percent";
import { CategoryChip } from "../CategoryChip";
import {
  sliceChip, sliceColor, sliceKey, sortBreakdown, toggleBreakdownSort,
  type BreakdownSort, type BreakdownSortKey,
} from "../../../lib/slice";
import { TONE_CLASS, compareToBaseline } from "../../../lib/comparison";
import type { BreakdownRow, Slice } from "../../../api/wire";

type ColKey = BreakdownSortKey | "share" | "avg12";

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
  const [sort, setSort] = useState<BreakdownSort>({ key: "amount", asc: false });

  const total = Number(expensesTotal);

  const toggle = (key: BreakdownSortKey) => setSort((prev) => toggleBreakdownSort(prev, key));
  const sorted = sortBreakdown(t, rows, sort);

  // On the shared grid table (`gridTable.ts`), like Holdings and Transactions:
  // CATEGORY and SHARE grow, the figures have floors, so sorting never moves a
  // column. SHARE orders exactly like AMOUNT and the 12-month column is a ratio
  // with gaps, so neither sorts. The last track holds the row's caret.
  const columns: { key: ColKey; labelKey: string; right: boolean; track: Track; pad: string; sort?: BreakdownSortKey }[] = [
    { key: "category", labelKey: "category", right: false, track: { min: "180px", max: "2fr" }, pad: "pl-3 pr-4", sort: "category" },
    { key: "amount", labelKey: "amount", right: true, track: { min: "7rem", max: "max-content" }, pad: "pr-4", sort: "amount" },
    { key: "share", labelKey: "share", right: false, track: { min: "140px", max: "3fr" }, pad: "pr-4" },
    { key: "txnCount", labelKey: "txnCount", right: true, track: { min: "4rem", max: "max-content" }, pad: "pr-10", sort: "txnCount" },
    { key: "avg12", labelKey: "vsAvg12", right: true, track: { min: "5rem", max: "max-content" }, pad: "pr-2" },
  ];
  const tracks = [...columns.map((c) => c.track), { min: "2.25rem" }];
  const pad = Object.fromEntries(columns.map((c) => [c.key, c.pad])) as Record<ColKey, string>;

  return (
    <Surface className="w-full">
      <div className="flex flex-col p-5">
        <h2 className="text-fg font-semibold text-sm">{t("budget.overview.breakdown.title")}</h2>
        <div className="mt-3">
          <GridTable
            tracks={tracks}
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
                        <SortHeader
                          testId={`sort-${c.sort}`}
                          label={t(`budget.overview.breakdown.${c.labelKey}`)}
                          active={active}
                          asc={sort.asc}
                          right={c.right}
                          onClick={() => toggle(c.sort!)}
                        />
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
            {sorted.map((row) => {
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
                      {/* One decimal whatever the percentDecimals pref:
                       *  compact, and 61.86 % doesn't read as 62 %. */}
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
