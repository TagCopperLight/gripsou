import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { UseQueryResult } from "@tanstack/react-query";

import { CardError } from "../../../ui/CardError";
import { PeriodLine } from "./PeriodLine";
import { FiguresSurface } from "./FiguresSurface";
import { SankeySurface } from "./SankeySurface";
import { BreakdownSurface } from "./BreakdownSurface";
import { TrendSurface } from "./TrendSurface";
import { EmptyPeriodSurface } from "./EmptyPeriodSurface";
import { AiBanner, AiRunningPill } from "./AiBanner";
import { useBudget } from "../budgetContext";
import {
  useBudgetSummary, useBudgetTrend, useLatestDataMonth,
} from "../../../api/overview";
import { anchorMonth, currentMonth, periodBounds, type Period } from "../../../lib/period";
import { addMonths } from "../../../lib/month";
import { hasFlow } from "../../../lib/sankeyGraph";
import type { BudgetSummary, Slice } from "../../../api/wire";
import { usePrivacy } from "../../../auth/usePrivacy";
import { staleClass } from "../../../ui/stale";

export function BudgetOverview() {
  const { period: picked } = useBudget();
  const latest = useLatestDataMonth();

  // Defaults to the latest month with transactions.
  const lastMonth: string | null = latest.isSuccess ? latest.data : currentMonth();
  const period: Period | undefined =
    picked ?? (latest.isPending ? undefined : { mode: "month", month: lastMonth ?? currentMonth() });

  // One page through every step of the load: swapping pages would redraw the skeleton and flicker.
  const summary = useBudgetSummary(period);
  return <OverviewPage period={period} lastMonth={lastMonth} summary={summary} />;
}

/** Drawn before the period and summary are known: the frame renders, bones stand in. */
function OverviewPage({ period, lastMonth, summary }: {
  period: Period | undefined;
  lastMonth: string | null;
  summary: UseQueryResult<BudgetSummary>;
}) {
  const navigate = useNavigate();
  const { setPeriod, patchFilters } = useBudget();
  const privacy = usePrivacy();

  const data = summary.data;
  const stale = summary.isPlaceholderData;
  const empty = data !== undefined && data.txnCount === 0;

  const month = period?.mode === "month" ? period.month : null;
  const canStepBack = month !== null;
  const canStepForward = month !== null && lastMonth !== null && month < lastMonth;
  const step = (delta: number) => {
    if (month !== null) setPeriod({ mode: "month", month: addMonths(month, delta) });
  };
  const selectMonth = useCallback(
    (m: string) => setPeriod({ mode: "month", month: m }),
    [setPeriod],
  );

  /** Deep links show exactly the rows behind the clicked figure, so this resets the slice, time, needs-review and
   *  internal-transfer fields: `patchFilters` merges, so an earlier Uncategorised click and a category click would AND
   *  into an empty list. Search, account and tag filters stay. */
  const openTransactions = (slice?: Slice) => {
    if (period === undefined) return;
    const { from, to } = periodBounds(period);
    const base = {
      categoryIds: [] as string[],
      uncategorized: false,
      bucket: "all" as const,
      needsReview: false,
      transfers: false,
      // `custom`: the select shows the real dates, not "All time".
      timeFrame: "custom" as const,
      from,
      to,
      period,
    };
    if (slice?.kind === "category") {
      patchFilters({ ...base, categoryIds: [slice.category.id] });
    } else if (slice?.kind === "uncategorised") {
      // `bucket: "out"` is needed too: the flag alone would also match uncategorised income.
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
        privacy={privacy}
        canStepBack={canStepBack}
        canStepForward={canStepForward}
        onStep={step}
        end={<AiRunningPill />}
      />

      <AiBanner />

      {summary.isError && data === undefined ? (
        <CardError onRetry={() => void summary.refetch()} className="h-40" />
      ) : (
        <>
          {/* Dimmed while stepping to another month; the trend dims on its own query. */}
          <div className="flex flex-col gap-5">
            <FiguresSurface summary={data} masked={privacy.masked} stale={stale} />
            {data === undefined ? (
              <>
                <SankeySurface />
                <BreakdownSurface />
              </>
            ) : empty ? (
              <div className={staleClass(stale)}>
                <EmptyPeriodSurface />
              </div>
            ) : (
              <>
                {hasFlow(data.sankey) && (
                  <SankeySurface sankey={data.sankey} onSeeTransactions={() => openTransactions()} masked={privacy.masked} stale={stale} />
                )}
                {data.breakdown.length > 0 && (
                  <BreakdownSurface
                    rows={data.breakdown}
                    expensesTotal={data.figures.expenses.amount}
                    onOpen={openTransactions}
                    masked={privacy.masked}
                    stale={stale}
                  />
                )}
              </>
            )}
          </div>
          {!empty && (
            <TrendSection anchor={period && anchorMonth(period)} onSelectMonth={selectMonth} masked={privacy.masked} />
          )}
        </>
      )}
    </div>
  );
}

/** Its own query so a failing trend degrades one surface, not the page. An empty period has no trend, so its request goes unused. */
function TrendSection({
  anchor, onSelectMonth, masked,
}: {
  anchor: string | undefined;
  onSelectMonth: (month: string) => void;
  masked: boolean;
}) {
  const trend = useBudgetTrend(anchor);
  if (trend.isError && trend.data === undefined) {
    return <CardError onRetry={() => void trend.refetch()} className="h-60" />;
  }
  return trend.data === undefined ? (
    <TrendSurface />
  ) : (
    <TrendSurface trend={trend.data} onSelectMonth={onSelectMonth} masked={masked} stale={trend.isPlaceholderData} />
  );
}
