import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";

import { Surface } from "../../Surface";
import { Money } from "../../Money";
import { Percent } from "../../Percent";
import { CategoryChip } from "../CategoryChip";
import { sliceChip, sliceColor, sliceKey, sliceLabel } from "../../../lib/slice";
import type { BreakdownRow, Slice } from "../../../api/overview";

type SortKey = "category" | "amount" | "share" | "avg12";

type BreakdownSurfaceProps = {
  rows: BreakdownRow[];
  /** The period's total expenses, so SHARE is arithmetic here rather than a
   *  second server opinion that could round differently from the column beside
   *  it. */
  expensesTotal: string;
  /** A row was clicked: open Transactions filtered to the period AND this
   *  slice. Never called for the `other` row. */
  onOpen: (slice: Slice) => void;
};

/** How far a row's amount differs from its 12-month average, as a ratio.
 *  `undefined` when the server sent no baseline — always the case on `other`,
 *  whose membership changes month to month. */
function vsAvg(row: BreakdownRow): number | undefined {
  if (row.avg12 === undefined) return undefined;
  const base = Number(row.avg12);
  if (base === 0) return undefined;
  return (Number(row.amount) - base) / Math.abs(base);
}

export function BreakdownSurface({ rows, expensesTotal, onOpen }: BreakdownSurfaceProps) {
  const { t } = useTranslation();
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "amount", asc: false });

  const total = Number(expensesTotal);

  const toggle = (key: SortKey) =>
    setSort((prev) => (prev.key === key ? { key, asc: !prev.asc } : { key, asc: false }));

  // `other` is a rollup, not a peer: it stays pinned last however the real rows
  // are ordered, so the table always reads "…and everything else".
  const real = rows.filter((r) => r.slice.kind !== "other");
  const rollup = rows.filter((r) => r.slice.kind === "other");

  const sorted = [...real].sort((a, b) => {
    const dir = sort.asc ? 1 : -1;
    switch (sort.key) {
      case "category":
        // Name order is alphabetical, so "ascending" means A→Z; the `dir` flip
        // would otherwise make the default descending and read backwards.
        // `sliceLabel`, not `sliceChip(...)?.name`: the chip's own name falls
        // back to "" for uncategorised, which would sort it before every real
        // category instead of alongside them by its displayed label.
        return -dir * sliceLabel(t, a.slice).localeCompare(sliceLabel(t, b.slice));
      case "avg12": {
        // `undefined` (no baseline) always sorts last, in EITHER direction —
        // comparing two `undefined`s as `-Infinity - -Infinity` produced NaN,
        // which `Array.sort` leaves in an unstable, direction-dependent spot
        // (M6). Real values still compare (and flip) normally.
        const va = vsAvg(a);
        const vb = vsAvg(b);
        if (va === undefined && vb === undefined) return 0;
        if (va === undefined) return 1;
        if (vb === undefined) return -1;
        return dir * (va - vb);
      }
      default:
        // SHARE is amount divided by one constant, so it orders identically.
        return dir * (Number(a.amount) - Number(b.amount));
    }
  });

  const columns: { key: SortKey; labelKey: string; align: string }[] = [
    { key: "category", labelKey: "category", align: "text-left" },
    { key: "amount", labelKey: "amount", align: "text-right" },
    { key: "share", labelKey: "share", align: "text-left" },
    { key: "avg12", labelKey: "vsAvg12", align: "text-right" },
  ];

  return (
    <Surface className="w-full">
      <div className="flex flex-col p-5">
        <h2 className="text-fg font-semibold text-sm">{t("budget.overview.breakdown.title")}</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className={`pb-2 text-xs font-medium text-fg-faint uppercase ${c.align}`}
                  >
                    <button
                      type="button"
                      data-testid={`sort-${c.key}`}
                      onClick={() => toggle(c.key)}
                      className="cursor-pointer transition-colors duration-140 hover:text-fg"
                    >
                      {t(`budget.overview.breakdown.${c.labelKey}`)}
                    </button>
                  </th>
                ))}
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {[...sorted, ...rollup].map((row) => {
                const linkable = row.slice.kind !== "other";
                const share = total === 0 ? 0 : Number(row.amount) / total;
                const diff = vsAvg(row);
                return (
                  <tr
                    key={sliceKey(row.slice)}
                    data-testid={`breakdown-row-${sliceKey(row.slice)}`}
                    onClick={() => linkable && onOpen(row.slice)}
                    className={`border-t border-fg/6 ${
                      linkable ? "cursor-pointer hover:bg-fg/4" : ""
                    }`}
                  >
                    <td className="py-2 pr-4">
                      <CategoryChip category={sliceChip(t, row.slice)} />
                    </td>
                    <td className="py-2 pr-4 text-right">
                      <Money value={row.amount} className="text-sm text-fg" />
                    </td>
                    <td className="py-2 pr-4">
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-fg/10">
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
                    <td className="py-2 text-right" data-testid="avg12">
                      {diff === undefined ? (
                        <span className="text-sm text-fg-faint">—</span>
                      ) : (
                        <span className={`text-sm ${diff > 0 ? "text-red" : "text-green"}`}>
                          <Percent value={diff} signed />
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      {linkable && (
                        <button
                          type="button"
                          data-testid="row-caret"
                          aria-label={t("budget.overview.breakdown.open")}
                          // The row itself is already a click target (keyboard
                          // users had no way in before this button existed);
                          // stopping propagation here keeps `onOpen` firing
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
            </tbody>
          </table>
        </div>
      </div>
    </Surface>
  );
}
