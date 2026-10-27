import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";

import { Surface } from "./Surface";
import { MaskedMoney, PrivacyEye } from "./PrivateMoney";
import { usePrivacy } from "../auth/usePrivacy";
import { Percent } from "./Percent";
import { SegmentedControl } from "./SegmentedControl";
import { StackedAreaChart, type StackedSeries } from "./StackedAreaChart";
import { ChartLegend } from "./ChartLegend";
import { CardState } from "./CardState";
import { NetWorthEmpty } from "./NetWorthEmpty";
import { useNetWorth, useAccountSeries } from "../api/hooks";
import { rangeOptions, type Range } from "../lib/ranges";
import { bySize, legendAccounts } from "../lib/accounts";

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
  const [range, setRange] = useState<Range>("6mo");
  const RANGE_OPTIONS = rangeOptions(t);
  const nw = useNetWorth(range);
  const series = useAccountSeries(range);
  const ready = nw.data !== undefined && series.data !== undefined;
  const isError = nw.isError || series.isError;
  // No accounts: the same stand-in as the dashboard's chart, rather than a
  // 0 € headline and a gain pill that would only look like data.
  const empty = ready && nw.data.points.length === 0;

  const summary = nw.data?.summary;
  const gainUp = summary ? Number(summary.gainAbs) >= 0 : true;

  const accounts = series.data ? bySize(series.data) : [];
  const points = series.data?.points ?? [];
  const stacked: StackedSeries[] = accounts.map((a) => ({
    key: a.id,
    name: a.name,
    color: a.color,
    data: points.map((p) => [p.t, Number(p.values[a.id] ?? 0)] as [number, number]),
  }));
  // The biggest accounts by name, then "+N others": with many accounts a full
  // legend took over the header. The list below names them all.
  const legend = legendAccounts(series.data ?? { accounts: [], points: [] });
  const legendItems = [
    ...legend.shown.map((a) => ({ key: a.id, label: a.name, color: a.color })),
    ...(legend.others.length > 0
      ? [{ key: "others", label: t("account.legendOthers", { count: legend.others.length }), title: legend.others.join(", ") }]
      : []),
  ];

  return (
    <Surface className={`w-full ${className}`}>
      <div className="flex flex-col p-4 md:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:justify-between md:gap-4">
          <div className="flex flex-col gap-1 md:shrink-0">
            <p className="text-fg font-semibold text-sm">
              {t("dashboard.netWorth.title")}
              {ready && !empty && privacy.enabled && (
                <span className="ml-3 inline-flex align-middle">
                  <PrivacyEye size="sm" masked={privacy.masked} toggle={privacy.toggle} />
                </span>
              )}
            </p>
            {ready && !empty && (
              <>
                <MaskedMoney masked={privacy.masked} value={summary?.netWorth ?? "0"} className="whitespace-nowrap text-[32px] font-semibold tracking-tight md:text-[40px]" />
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <div className={`flex self-start items-center gap-1 whitespace-nowrap py-1 px-2 rounded-lg text-sm ${gainUp ? "bg-green-soft text-green" : "bg-red-soft text-red"}`}>
                    {gainUp ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
                    <MaskedMoney masked={privacy.masked} value={summary?.gainAbs ?? "0"} signed />
                    <span className="font-mono ml-2">(<Percent value={summary?.gainPct ?? "0"} signed />)</span>
                  </div>
                  <p className="text-fg-faint text-sm">{t(`range.over.${range}`)}</p>
                </div>
              </>
            )}
          </div>
          {!empty && (
            <div className="flex min-w-0 flex-col md:items-end">
              <div className="hidden md:block">
                <SegmentedControl options={RANGE_OPTIONS} value={range} onChange={(v) => setRange(v as Range)} />
              </div>
              {/* Phone: one swipeable row instead of three wrapped ones. */}
              <ChartLegend className="-mx-1 overflow-x-auto px-1 md:mt-3 md:flex-wrap md:justify-end md:overflow-visible" items={legendItems} onHover={onHover} />
            </div>
          )}
        </div>
        {/* Phone: the seven ranges scroll on their own row under the chart. */}
        {!empty && (
          <div className="order-last -mx-1 mt-3 flex justify-center-safe overflow-x-auto px-1 md:hidden">
            <SegmentedControl options={RANGE_OPTIONS} value={range} onChange={(v) => setRange(v as Range)} className="w-max" />
          </div>
        )}
        {empty ? (
          <NetWorthEmpty className="mt-4 h-80" />
        ) : ready ? (
          <StackedAreaChart className="mt-4" series={stacked} highlight={highlight} />
        ) : (
          <CardState
            variant={isError ? "error" : "loading"}
            onRetry={() => {
              nw.refetch();
              series.refetch();
            }}
            className="mt-4 h-80"
          />
        )}
      </div>
    </Surface>
  );
}
