import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Surface } from "../../ui/Surface";
import { CardTitle } from "../../ui/CardTitle";
import { usePrivacy } from "../../auth/usePrivacy";
import { PhoneRangeRow, RangeSelector } from "../../ui/RangeSelector";
import { ExcludedFootnote } from "../../ui/FxNote";
import { NetWorthHeadline } from "../dashboard/NetWorthHeadline";
import { StackedAreaChart, type StackedSeries } from "./StackedAreaChart";
import { ChartLegend } from "../../ui/ChartLegend";
import { CardError } from "../../ui/CardError";
import { LoadingFrame } from "../../ui/LoadingFrame";
import { Bone, ChartBone, Skeleton, TextBone } from "../../ui/Skeleton";
import { staleClass } from "../../ui/stale";
import { NetWorthEmpty } from "../connections/NetWorthEmpty";
import { useNetWorth, useAccountSeries } from "../../api/accounts";
import { useFxExcludedCount } from "../../api/holdings";
import { DEFAULT_RANGE, type Range } from "../../api/wire";
import { bySize, legendAccounts } from "../../lib/accounts";
import { numberOrNull } from "../../lib/valueChart";

type AccountsChartCardProps = {
  /** The account hovered here or in the list below: its band comes forward. */
  highlight?: string | null;
  onHover?: (accountId: string | null) => void;
  className?: string;
};

export function AccountsChartCard({ highlight = null, onHover, className = "" }: AccountsChartCardProps) {
  const { t } = useTranslation();
  // One eye for the headline and the gain; the percentage is never masked.
  const privacy = usePrivacy();
  const [range, setRange] = useState<Range>(DEFAULT_RANGE);
  const nw = useNetWorth(range);
  const series = useAccountSeries(range);
  const excluded = useFxExcludedCount();
  const ready = nw.data !== undefined && series.data !== undefined;
  const loading = nw.isPending || series.isPending;
  const isError = !ready && !loading;
  // A new range keeps the last one's figures on screen, dimmed, until its own arrive.
  const stale = staleClass(nw.isPlaceholderData || series.isPlaceholderData);
  // No accounts: the same stand-in as the dashboard's chart, rather than a
  // 0 € headline and a gain pill that would only look like data.
  const empty = ready && nw.data.points.length === 0;

  const accounts = series.data ? bySize(series.data) : [];
  const points = series.data?.points ?? [];
  const stacked: StackedSeries[] = accounts.map((a) => ({
    key: a.id,
    name: a.name,
    color: a.color,
    // Absent: nothing held that day. Null: no rate that day, a gap.
    data: points.map((p) => [p.t, numberOrNull(p.values[a.id] ?? "0")] as [number, number | null]),
  }));
  // The biggest accounts by name, then "+N others": with many accounts a full
  // legend would take over the header. The list below names them all.
  const legend = legendAccounts(series.data ?? { accounts: [], points: [] });
  const legendItems = [
    ...legend.shown.map((a) => ({ key: a.id, label: a.name, color: a.color })),
    ...(legend.others.length > 0
      ? [{ key: "others", label: t("account.legendOthers", { count: legend.others.length }), title: legend.others.join(", ") }]
      : []),
  ];

  return (
    <Surface className={`w-full ${className}`}>
      <LoadingFrame loading={loading} className="flex flex-col p-4 md:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:justify-between md:gap-4">
          <div className="flex flex-col gap-1 md:shrink-0">
            <CardTitle privacy={ready && !empty && privacy}>
              {t("dashboard.netWorth.title")}
            </CardTitle>
            {!empty && !isError && (
              <div className={`flex flex-col gap-1 ${stale}`}>
                <NetWorthHeadline summary={ready ? nw.data.summary : undefined} range={range} masked={privacy.masked} />
              </div>
            )}
          </div>
          {!empty && (
            <div className="flex min-w-0 flex-col md:items-end">
              <div className="hidden md:block">
                <RangeSelector value={range} onChange={setRange} />
              </div>
              {/* Phone: one swipeable row instead of three wrapped ones. */}
              {series.data === undefined ? (
                // The accounts' names: three of them, as many as most legends show.
                <Skeleton className="flex items-center gap-4 md:mt-3">
                  {[80, 64, 96].map((w) => (
                    <span key={w} className="flex items-center gap-2">
                      <Bone className="h-0.5 w-4" />
                      <TextBone text="text-xs" style={{ width: w }} />
                    </span>
                  ))}
                </Skeleton>
              ) : (
                <ChartLegend className={`-mx-1 overflow-x-auto px-1 md:mt-3 md:flex-wrap md:justify-end md:overflow-visible ${stale}`} items={legendItems} onHover={onHover} />
              )}
            </div>
          )}
        </div>
        {!empty && <PhoneRangeRow value={range} onChange={setRange} />}
        {empty ? (
          <NetWorthEmpty className="mt-4 h-80" />
        ) : ready ? (
          <StackedAreaChart className={`mt-4 ${stale}`} series={stacked} highlight={highlight} />
        ) : loading ? (
          <ChartBone className="mt-4 h-80" />
        ) : (
          <CardError
            onRetry={() => {
              nw.refetch();
              series.refetch();
            }}
            className="mt-4 h-80"
          />
        )}
        {ready && !empty && nw.data.summary.fxMissing && <ExcludedFootnote count={excluded} className="order-last mt-3" />}
      </LoadingFrame>
    </Surface>
  );
}
