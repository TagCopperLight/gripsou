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

  // Until the reader picks a period, the page opens on the latest month that
  // has transactions — not the current month, which stays empty for the first
  // days of every month until the bank's feed catches up.
  const lastMonth: string | null = latest.isSuccess ? latest.data : currentMonth();
  const period: Period | undefined =
    picked ?? (latest.isPending ? undefined : { mode: "month", month: lastMonth ?? currentMonth() });

  return period === undefined
    ? <OverviewPage lastMonth={lastMonth} />
    : <OverviewOf period={period} lastMonth={lastMonth} />;
}

function OverviewOf({ period, lastMonth }: { period: Period; lastMonth: string | null }) {
  const summary = useBudgetSummary(period);
  return <OverviewPage period={period} lastMonth={lastMonth} summary={summary} />;
}

/** The whole page, drawn before its period is known (`period` undefined, while
 *  the latest month with data loads) and before its summary is (`summary`
 *  undefined or pending): the frame renders, bones stand in for the figures and
 *  charts. */
function OverviewPage({ period, lastMonth, summary }: {
  period?: Period;
  lastMonth: string | null;
  summary?: UseQueryResult<BudgetSummary>;
}) {
  const navigate = useNavigate();
  const { setPeriod, patchFilters } = useBudget();
  // One eye, in the period line, for every amount of the page.
  const privacy = usePrivacy();

  const data = summary?.data;
  const stale = Boolean(summary?.isPlaceholderData);
  const empty = data !== undefined && data.txnCount === 0;

  const month = period?.mode === "month" ? period.month : null;
  // Back is always open: a month before the first transaction is an empty
  // month like any other (user's call).
  const canStepBack = month !== null;
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
    // Only a loaded summary links here, and a summary has a period.
    if (period === undefined) return;
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
        privacy={privacy}
        canStepBack={canStepBack}
        canStepForward={canStepForward}
        onStep={step}
        end={<AiRunningPill />}
      />

      <AiBanner />

      {summary?.isError && data === undefined ? (
        <CardError onRetry={() => void summary.refetch()} className="h-40" />
      ) : (
        <>
          {/* A step to another month keeps this month's data, dimmed, until
              the new one lands. The trend dims on its own query. */}
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
          {data === undefined ? (
            <TrendSurface />
          ) : (
            !empty && period && (
              <TrendSection anchor={anchorMonth(period)} onSelectMonth={selectMonth} masked={privacy.masked} />
            )
          )}
        </>
      )}
    </div>
  );
}

/** Its own component, so the trend is only asked for when it is shown, and its
 *  own query, so a failing trend degrades one surface rather than the page. */
function TrendSection({
  anchor, onSelectMonth, masked,
}: {
  anchor: string;
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
