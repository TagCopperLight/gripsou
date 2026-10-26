import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";

import { Surface } from "./Surface";
import { Money } from "./Money";
import { PrivateMoney } from "./PrivateMoney";
import { Percent } from "./Percent";
import { SegmentedControl } from "./SegmentedControl";
import { ValueChart } from "./ValueChart";
import { ChartLegend } from "./ChartLegend";
import { CardState } from "./CardState";
import { useNetWorth } from "../api/hooks";
import { getPrefs } from "../lib/prefs";
import { currencySymbol } from "../lib/currency";
import { SURFACE } from "../lib/chartTheme";
import { rangeOptions, type Range } from "../lib/ranges";
import { legendItems, plotSeries, type ChartSeries, type ChartUnit } from "../lib/valueChart";

const GREEN = "#34d399"; // color-green
const GRAY = "#777471"; // fg-faint

export function NetWorthCard({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  const [range, setRange] = useState<Range>("6mo");
  const [unit, setUnit] = useState<ChartUnit>("value");
  const { data, isError, refetch } = useNetWorth(range);
  const ready = data !== undefined;

  const UNIT_OPTIONS = [
    { value: "value", label: t("common.value") },
    { value: "percent", label: "%" },
  ];

  // Phone: the word "Value" costs more width than it earns next to "%".
  const UNIT_OPTIONS_SHORT = [
    { value: "value", label: currencySymbol(getPrefs().currency) },
    { value: "percent", label: "%" },
  ];

  const RANGE_OPTIONS = rangeOptions(t);

  // Net worth (green area) over capital invested (dashed). The legend is read
  // off the plotted series, so it turns red with the line.
  const points = data?.points ?? [];
  const series: ChartSeries[] = [
    { name: t("dashboard.netWorth.capitalInvested"), data: points.map((p) => [p.t, Number(p.invested)]), color: GRAY, dashed: true },
    { name: t("dashboard.netWorth.netWorth"), data: points.map((p) => [p.t, Number(p.netWorth)]), color: GREEN, area: true },
  ];
  const legend = legendItems(plotSeries(series, unit, t("common.return")));

  const summary = data?.summary;
  const gainUp = summary ? Number(summary.gainAbs) >= 0 : true;

  return (
    <Surface className={`w-full ${className}`}>
      <div className="flex flex-col p-4 md:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:justify-between md:gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-fg font-semibold text-sm">{t("dashboard.netWorth.title")}</p>
              <SegmentedControl
                options={UNIT_OPTIONS_SHORT}
                value={unit}
                onChange={(v) => setUnit(v as ChartUnit)}
                className="md:hidden"
              />
            </div>
            {ready && (
              <>
                {/* The dashboard's single biggest number, and the only place
                    that can silently omit a zeroed holding — so it carries the
                    same warning treatment as the holdings/accounts cards. */}
                <span className="flex items-baseline gap-2">
                  <PrivateMoney value={summary?.netWorth ?? "0"} className="whitespace-nowrap text-[32px] font-semibold tracking-tight md:text-[40px]" />
                  {summary?.fxMissing && (
                    <span
                      title={t("dashboard.fxMissing")}
                      className="text-fg-faint text-sm"
                      aria-label={t("dashboard.fxMissing")}
                    >
                      ⚠
                    </span>
                  )}
                </span>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <div className={`flex self-start items-center gap-1 whitespace-nowrap py-1 px-2 rounded-lg text-sm ${gainUp ? "bg-green-soft text-green" : "bg-red-soft text-red"}`}>
                    {gainUp ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
                    <Money value={summary?.gainAbs ?? "0"} signed />
                    <span className="font-mono ml-2">(<Percent value={summary?.gainPct ?? "0"} signed />)</span>
                  </div>
                  <p className="text-fg-faint text-sm">{t(`range.over.${range}`)}</p>
                </div>
                {/* Not the ⚠ glyph the other warnings use: this one is not about
                    one holding being left out, it is about every figure on the
                    dashboard being denominated in a currency the user did not
                    pick. A tooltip nobody hovers would leave them reading euros
                    as dollars. */}
                {summary?.reportingFxMissing && (
                  <p
                    role="status"
                    className="bg-amber-soft text-fg-dim self-start rounded-lg px-2 py-1 text-sm"
                  >
                    {t("dashboard.reportingFxMissing", {
                      currency: getPrefs().currency,
                    })}
                  </p>
                )}
              </>
            )}
          </div>
          <div className="flex flex-col gap-2 md:gap-3">
            <div className="hidden items-center gap-6 md:flex">
              <SegmentedControl options={RANGE_OPTIONS} value={range} onChange={(v) => setRange(v as Range)} />
              <SegmentedControl options={UNIT_OPTIONS} value={unit} onChange={(v) => setUnit(v as ChartUnit)} />
            </div>
            <ChartLegend items={legend} className="md:self-end" />
          </div>
        </div>
        {/* Phone: the seven ranges scroll on their own row under the chart. */}
        <div className="order-last -mx-1 mt-3 flex justify-center-safe overflow-x-auto px-1 md:hidden">
          <SegmentedControl options={RANGE_OPTIONS} value={range} onChange={(v) => setRange(v as Range)} className="w-max" />
        </div>
        {ready ? (
          <ValueChart
            series={series}
            unit={unit}
            percentLabel={t("common.return")}
            className="mt-4"
            surfaceColor={SURFACE}
          />
        ) : (
          <CardState
            variant={isError ? "error" : "loading"}
            onRetry={() => refetch()}
            className="mt-4 h-80"
          />
        )}
      </div>
    </Surface>
  );
}
