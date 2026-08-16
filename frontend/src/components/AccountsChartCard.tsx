import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";

import { Surface } from "./Surface";
import { Money } from "./Money";
import { Percent } from "./Percent";
import { SegmentedControl } from "./SegmentedControl";
import { StackedAreaChart, type StackedSeries } from "./StackedAreaChart";
import { ChartLegend } from "./ChartLegend";
import { CardState } from "./CardState";
import { useNetWorth, useAccountSeries } from "../api/hooks";

const RANGE_OPTIONS = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "1mo", label: "1mo" },
  { value: "6mo", label: "6mo" },
  { value: "1y", label: "1y" },
  { value: "ytd", label: "ytd" },
  { value: "max", label: "max" },
];

const RANGE_LABEL: Record<string, string> = {
  "24h": "24h", "7d": "7d", "1mo": "1mo", "6mo": "6mo", "1y": "1y", ytd: "ytd", max: "max",
};

export function AccountsChartCard({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  const [range, setRange] = useState("6mo");
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
                <Money value={summary?.netWorth ?? "0"} className="whitespace-nowrap text-[32px] font-semibold tracking-tight md:text-[40px]" />
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <div className={`flex self-start items-center gap-1 whitespace-nowrap py-1 px-2 rounded-lg text-sm ${gainUp ? "bg-green-soft text-green" : "bg-red-soft text-red"}`}>
                    {gainUp ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
                    <Money value={summary?.gainAbs ?? "0"} signed />
                    <span className="font-mono ml-2">(<Percent value={summary?.gainPct ?? "0"} signed />)</span>
                  </div>
                  <p className="text-fg-faint text-sm">{t("dashboard.netWorth.over", { range: RANGE_LABEL[range] })}</p>
                </div>
              </>
            )}
          </div>
          <div className="flex flex-col md:items-end">
            <div className="hidden md:block">
              <SegmentedControl options={RANGE_OPTIONS} value={range} onChange={setRange} />
            </div>
            {/* Phone: one swipeable row instead of three wrapped ones. */}
            <ChartLegend className="-mx-1 overflow-x-auto px-1 md:mt-3 md:flex-wrap md:justify-end md:overflow-visible" items={legendItems} />
          </div>
        </div>
        {/* Phone: the seven ranges scroll on their own row under the chart. */}
        <div className="order-last -mx-1 mt-3 flex justify-center-safe overflow-x-auto px-1 md:hidden">
          <SegmentedControl options={RANGE_OPTIONS} value={range} onChange={setRange} className="w-max" />
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
