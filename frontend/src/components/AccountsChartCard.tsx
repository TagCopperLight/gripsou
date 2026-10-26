import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";

import { Surface } from "./Surface";
import { MaskedMoney, PrivateMoney } from "./PrivateMoney";
import { usePrivacy } from "../auth/usePrivacy";
import { Percent } from "./Percent";
import { SegmentedControl } from "./SegmentedControl";
import { StackedAreaChart, type StackedSeries } from "./StackedAreaChart";
import { ChartLegend } from "./ChartLegend";
import { CardState } from "./CardState";
import { useNetWorth, useAccountSeries } from "../api/hooks";
import { rangeOptions, type Range } from "../lib/ranges";

export function AccountsChartCard({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  // One eye for the headline and the gain; the percentage is never masked.
  const privacy = usePrivacy();
  const [range, setRange] = useState<Range>("6mo");
  const RANGE_OPTIONS = rangeOptions(t);
  const nw = useNetWorth(range);
  const series = useAccountSeries(range);
  const ready = nw.data !== undefined && series.data !== undefined;
  const isError = nw.isError || series.isError;

  const summary = nw.data?.summary;
  const gainUp = summary ? Number(summary.gainAbs) >= 0 : true;

  const accounts = series.data?.accounts ?? [];
  const points = series.data?.points ?? [];
  const stacked: StackedSeries[] = accounts.map((a) => ({
    name: a.name,
    color: a.color,
    data: points.map((p) => [p.t, Number(p.values[a.id] ?? 0)] as [number, number]),
  }));
  const legendItems = accounts.map((a) => ({ label: a.name, color: a.color }));

  return (
    <Surface className={`w-full ${className}`}>
      <div className="flex flex-col p-4 md:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:justify-between md:gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-fg font-semibold text-sm">{t("dashboard.netWorth.title")}</p>
            {ready && (
              <>
                <PrivateMoney privacy={privacy} value={summary?.netWorth ?? "0"} className="whitespace-nowrap text-[32px] font-semibold tracking-tight md:text-[40px]" />
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
          <div className="flex flex-col md:items-end">
            <div className="hidden md:block">
              <SegmentedControl options={RANGE_OPTIONS} value={range} onChange={(v) => setRange(v as Range)} />
            </div>
            {/* Phone: one swipeable row instead of three wrapped ones. */}
            <ChartLegend className="-mx-1 overflow-x-auto px-1 md:mt-3 md:flex-wrap md:justify-end md:overflow-visible" items={legendItems} />
          </div>
        </div>
        {/* Phone: the seven ranges scroll on their own row under the chart. */}
        <div className="order-last -mx-1 mt-3 flex justify-center-safe overflow-x-auto px-1 md:hidden">
          <SegmentedControl options={RANGE_OPTIONS} value={range} onChange={(v) => setRange(v as Range)} className="w-max" />
        </div>
        {ready ? (
          <StackedAreaChart className="mt-4" series={stacked} />
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
