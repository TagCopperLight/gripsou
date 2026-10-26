import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";

import { Surface } from "./Surface";
import { MaskedMoney, PrivateMoney } from "./PrivateMoney";
import { usePrivacy } from "../auth/usePrivacy";
import { Percent } from "./Percent";
import { SegmentedControl } from "./SegmentedControl";
import { ValueChart } from "./ValueChart";
import { ChartLegend } from "./ChartLegend";
import { CardState } from "./CardState";
import { NetWorthEmpty } from "./NetWorthEmpty";
import { useHoldings, useNetWorth } from "../api/hooks";
import { ExcludedNote, FxAsterisk, FxFootnote } from "./FxNote";
import { unconverted } from "../lib/fxNote";
import { getPrefs } from "../lib/prefs";
import { currencySymbol } from "../lib/currency";
import { SURFACE } from "../lib/chartTheme";
import { rangeOptions, type Range } from "../lib/ranges";
import { legendItems, plotSeries, type ChartSeries, type ChartUnit } from "../lib/valueChart";

const GREEN = "#34d399"; // color-green
const GRAY = "#777471"; // fg-faint

export function NetWorthCard({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  // One eye for the headline and the gain; the percentage is never masked.
  const privacy = usePrivacy();
  const [range, setRange] = useState<Range>("6mo");
  const [unit, setUnit] = useState<ChartUnit>("value");
  const { data, isError, refetch } = useNetWorth(range);
  // Names what the headline leaves out; shares the holdings card's query.
  const holdings = useHoldings();
  const ready = data !== undefined;
  // No points means no accounts (the server sends none then): a 0 €
  // headline, a gain pill and a flat line would only look like data.
  const empty = ready && data.points.length === 0;

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
  const fxMissing = summary?.fxMissing ?? false;
  const excluded = unconverted(holdings.data ?? []);
  const gainUp = summary ? Number(summary.gainAbs) >= 0 : true;

  return (
    <Surface className={`w-full ${className}`}>
      <div className="flex flex-col p-4 md:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:justify-between md:gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-fg font-semibold text-sm">{t("dashboard.netWorth.title")}</p>
              {!empty && (
                <SegmentedControl
                  options={UNIT_OPTIONS_SHORT}
                  value={unit}
                  onChange={(v) => setUnit(v as ChartUnit)}
                  className="md:hidden"
                />
              )}
            </div>
            {ready && !empty && (
              <>
                <span className="flex items-baseline gap-2">
                  <PrivateMoney
                    privacy={privacy}
                    value={summary?.netWorth ?? "0"}
                    className="whitespace-nowrap text-[32px] font-semibold tracking-tight md:text-[40px]"
                    after={fxMissing && <FxAsterisk size="lg" />}
                  />
                </span>
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
            <div className="flex flex-col gap-2 md:gap-3">
              <div className="hidden items-center gap-6 md:flex">
                <SegmentedControl options={RANGE_OPTIONS} value={range} onChange={(v) => setRange(v as Range)} />
                <SegmentedControl options={UNIT_OPTIONS} value={unit} onChange={(v) => setUnit(v as ChartUnit)} />
              </div>
              <ChartLegend items={legend} className="md:self-end" />
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
        {/* Last, after the phone's range row too. */}
        {ready && !empty && fxMissing && (
          <FxFootnote className="order-last mt-3">
            <ExcludedNote items={excluded} masked={privacy.masked} />
          </FxFootnote>
        )}
      </div>
    </Surface>
  );
}
