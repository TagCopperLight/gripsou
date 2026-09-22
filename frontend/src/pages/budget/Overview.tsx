import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";

import { CardState } from "../../components/CardState";
import { PeriodLine } from "../../components/budget/overview/PeriodLine";
import { FiguresSurface } from "../../components/budget/overview/FiguresSurface";
import { SankeySurface } from "../../components/budget/overview/SankeySurface";
import { BreakdownSurface } from "../../components/budget/overview/BreakdownSurface";
import { TrendSurface } from "../../components/budget/overview/TrendSurface";
import { EmptyPeriodSurface } from "../../components/budget/overview/EmptyPeriodSurface";
import { useBudget } from "../../components/budget/budgetContext";
import { useBudgetSummary, useBudgetTrend } from "../../api/overview";
import { addMonths, anchorMonth, periodBounds, periodLabel } from "../../lib/period";
import { getPrefs } from "../../lib/prefs";
import type { Slice } from "../../api/overview";

export function BudgetOverview() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { period, setPeriod, patchFilters } = useBudget();

  const summary = useBudgetSummary(period);
  const trend = useBudgetTrend(anchorMonth(period));

  const data = summary.data;
  const empty = data !== undefined && data.txnCount === 0;

  /** Both deep links share the period half; only the slice half differs.
   *  `patchFilters` merges, so every deep link must first reset the slice and
   *  time fields a PREVIOUS deep link may have left behind (mirrors
   *  `clearFilter`'s "period" case) — otherwise an earlier Uncategorised
   *  click and a later category click AND together server-side and the list
   *  comes back always-empty. Search/account/tag filters are untouched. */
  const openTransactions = (slice?: Slice) => {
    const { from, to } = periodBounds(period);
    const reset = {
      categoryIds: [] as string[],
      uncategorized: false,
      bucket: "all" as const,
      timeFrame: "all" as const,
    };
    const base = { ...reset, from, to, periodLabel: periodLabel(period, i18n.language) };
    if (slice?.kind === "category") {
      patchFilters({ ...base, categoryIds: [slice.category.id] });
    } else if (slice?.kind === "uncategorised") {
      // No id to filter on. `bucket: "out"` is required as well as the flag:
      // the breakdown counts only the outflow half, while the flag alone would
      // also match uncategorised income.
      patchFilters({ ...base, uncategorized: true, bucket: "out" });
    } else {
      patchFilters(base);
    }
    void navigate({ to: "/budget/transactions" });
  };

  const stepBack = () => {
    if (period.mode !== "month") return;
    setPeriod({ mode: "month", month: addMonths(period.month, -1) });
  };

  return (
    <div className="flex flex-col gap-5">
      <PeriodLine
        txnCount={data?.txnCount ?? 0}
        fxMissing={data?.fxMissing ?? false}
        // An empty period is taken as the edge of the data; the empty surface
        // below carries the way past it.
        canStepBack={!empty}
      />

      {/* Not a tooltip: every figure below is in the app's base currency rather
          than the reader's, and a reader who does not hover would take them for
          converted ones. Same treatment as the dashboard's headline. */}
      {data?.reportingFxMissing && (
        <p
          role="status"
          data-testid="reporting-fx-missing"
          className="bg-amber-soft text-fg-dim self-start rounded-lg px-2 py-1 text-sm"
        >
          {t("dashboard.reportingFxMissing", { currency: getPrefs().currency })}
        </p>
      )}

      {data === undefined ? (
        <CardState
          variant={summary.isError ? "error" : "loading"}
          onRetry={() => void summary.refetch()}
          className="h-40"
        />
      ) : (
        <FiguresSurface summary={data} />
      )}

      {empty ? (
        <EmptyPeriodSurface onEarlier={period.mode === "month" ? stepBack : undefined} />
      ) : (
        <>
          {data && (
            <SankeySurface sankey={data.sankey} onSeeTransactions={() => openTransactions()} />
          )}
          {data && (
            <BreakdownSurface
              rows={data.breakdown}
              expensesTotal={data.expensesTotal}
              onOpen={openTransactions}
            />
          )}
          {/* Its own query, so a failing trend degrades one surface rather than
              the page. */}
          {trend.data === undefined ? (
            <CardState
              variant={trend.isError ? "error" : "loading"}
              onRetry={() => void trend.refetch()}
              className="h-60"
            />
          ) : (
            <TrendSurface trend={trend.data} onSelectMonth={(month) => setPeriod({ mode: "month", month })} />
          )}
        </>
      )}
    </div>
  );
}
