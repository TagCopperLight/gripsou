import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";

import { CardState } from "../../components/CardState";
import { PeriodLine } from "../../components/budget/overview/PeriodLine";
import { FiguresSurface } from "../../components/budget/overview/FiguresSurface";
import { SankeySurface } from "../../components/budget/overview/SankeySurface";
import { BreakdownSurface } from "../../components/budget/overview/BreakdownSurface";
import { TrendSurface } from "../../components/budget/overview/TrendSurface";
import { EmptyPeriodSurface } from "../../components/budget/overview/EmptyPeriodSurface";
import { AiBanner } from "../../components/budget/overview/AiBanner";
import { useBudget } from "../../components/budget/budgetContext";
import {
  useBudgetSummary, useBudgetTrend, useHasDataBefore, useLatestDataMonth,
} from "../../api/overview";
import { addMonths, anchorMonth, currentMonth, periodBounds, type Period } from "../../lib/period";
import { hasFlow } from "../../lib/sankeyGraph";
import { getPrefs } from "../../lib/prefs";
import type { Slice } from "../../api/overview";

export function BudgetOverview() {
  const { period: picked } = useBudget();
  const latest = useLatestDataMonth();

  // Until the reader picks a period, the page opens on the latest month that
  // has transactions — not the current month, which stays empty for the first
  // days of every month until the bank's feed catches up.
  const lastMonth: string | null = latest.isSuccess ? latest.data : currentMonth();
  const period: Period | undefined =
    picked ?? (latest.isPending ? undefined : { mode: "month", month: lastMonth ?? currentMonth() });

  if (period === undefined) return <CardState variant="loading" className="h-40" />;
  return <OverviewOf period={period} lastMonth={lastMonth} />;
}

function OverviewOf({ period, lastMonth }: { period: Period; lastMonth: string | null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setPeriod, patchFilters } = useBudget();

  const summary = useBudgetSummary(period);
  const hasBefore = useHasDataBefore(period.mode === "month" ? period.month : undefined);

  const data = summary.data;
  const empty = data !== undefined && data.txnCount === 0;

  const month = period.mode === "month" ? period.month : null;
  // Unknown counts as possible: a caret must not flicker off while the answer
  // is on its way.
  const canStepBack = month !== null && hasBefore.data !== false;
  const canStepForward = month !== null && lastMonth !== null && month < lastMonth;
  const step = (delta: number) => {
    if (month !== null) setPeriod({ mode: "month", month: addMonths(month, delta) });
  };
  const selectMonth = useCallback(
    (m: string) => setPeriod({ mode: "month", month: m }),
    [setPeriod],
  );

  /** Every deep link shows exactly the rows behind the figure clicked, so it
   *  resets whatever a previous visit left that would narrow or widen the
   *  list: the slice and time fields, "needs review", and "internal
   *  transfers" (the summary leaves paired transfers out, as the list does
   *  by default). `patchFilters` merges, so without this an earlier
   *  Uncategorised click and a later category click would AND together and
   *  the list would come back always-empty. Search, account and tag filters
   *  are the reader's own narrowing and stay. */
  const openTransactions = (slice?: Slice) => {
    const { from, to } = periodBounds(period);
    const base = {
      categoryIds: [] as string[],
      uncategorized: false,
      bucket: "all" as const,
      needsReview: false,
      transfers: false,
      // `custom`: the time-frame select shows what really applies — these
      // dates — rather than "All time".
      timeFrame: "custom" as const,
      from,
      to,
      period,
    };
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

  return (
    <div className="flex flex-col gap-5">
      <PeriodLine
        period={period}
        txnCount={data?.txnCount ?? 0}
        fxMissing={data?.fxMissing ?? false}
        canStepBack={canStepBack}
        canStepForward={canStepForward}
        onStep={step}
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

      <AiBanner />

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
        <EmptyPeriodSurface onEarlier={canStepBack ? () => step(-1) : undefined} />
      ) : (
        data && (
          <>
            {hasFlow(data.sankey) && (
              <SankeySurface sankey={data.sankey} onSeeTransactions={() => openTransactions()} />
            )}
            {data.breakdown.length > 0 && (
              <BreakdownSurface
                rows={data.breakdown}
                expensesTotal={data.figures.expenses.amount}
                onOpen={openTransactions}
              />
            )}
            <TrendSection anchor={anchorMonth(period)} onSelectMonth={selectMonth} />
          </>
        )
      )}
    </div>
  );
}

/** Its own component, so the trend is only asked for when it is shown, and its
 *  own query, so a failing trend degrades one surface rather than the page. */
function TrendSection({
  anchor, onSelectMonth,
}: {
  anchor: string;
  onSelectMonth: (month: string) => void;
}) {
  const trend = useBudgetTrend(anchor);
  return trend.data === undefined ? (
    <CardState
      variant={trend.isError ? "error" : "loading"}
      onRetry={() => void trend.refetch()}
      className="h-60"
    />
  ) : (
    <TrendSurface trend={trend.data} onSelectMonth={onSelectMonth} />
  );
}
