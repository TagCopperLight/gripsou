import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Surface } from "../../ui/Surface";
import { CardTitle } from "../../ui/CardTitle";
import { usePrivacy } from "../../auth/usePrivacy";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { PhoneRangeRow, RangeSelector } from "../../ui/RangeSelector";
import { NetWorthHeadline } from "./NetWorthHeadline";
import { ValueChart } from "../../ui/ValueChart";
import { ChartLegend } from "../../ui/ChartLegend";
import { CardState } from "../../ui/CardState";
import { NetWorthEmpty } from "../connections/NetWorthEmpty";
import { useFxExcludedCount } from "../../api/holdings";
import { useNetWorth } from "../../api/accounts";
import { ExcludedFootnote } from "../../ui/FxNote";
import { usePrefs } from "../../auth/context";
import { currencySymbol } from "../../lib/currency";
import { FG_FAINT, GREEN, SURFACE } from "../../lib/theme";
import type { Range } from "../../api/wire";
import { legendItems, numberOrNull, plotSeries, type ChartSeries, type ChartUnit } from "../../lib/valueChart";

export function NetWorthCard({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  const readerCurrency = usePrefs().currency;
  // One eye for the headline and the gain; the percentage is never masked.
  const privacy = usePrivacy();
  const [range, setRange] = useState<Range>("6mo");
  const [unit, setUnit] = useState<ChartUnit>("value");
  const { data, isError, refetch } = useNetWorth(range);
  // Counts what the headline leaves out; shares the holdings card's query.
  const excluded = useFxExcludedCount();
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
    { value: "value", label: currencySymbol(readerCurrency) },
    { value: "percent", label: "%" },
  ];

  // Net worth (green area) over capital invested (dashed). The legend is read
  // off the plotted series, so it turns red with the line.
  const points = data?.points ?? [];
  const series: ChartSeries[] = [
    { name: t("dashboard.netWorth.capitalInvested"), data: points.map((p) => [p.t, numberOrNull(p.invested)]), color: FG_FAINT, dashed: true },
    { name: t("dashboard.netWorth.netWorth"), data: points.map((p) => [p.t, numberOrNull(p.netWorth)]), color: GREEN, area: true },
  ];
  const legend = legendItems(plotSeries(series, unit, t("common.return")));

  return (
    <Surface className={`w-full ${className}`}>
      <div className="flex flex-col p-4 md:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:justify-between md:gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <CardTitle privacy={ready && !empty && privacy}>
                {t("dashboard.netWorth.title")}
              </CardTitle>
              {!empty && (
                <SegmentedControl
                  options={UNIT_OPTIONS_SHORT}
                  value={unit}
                  onChange={(v) => setUnit(v as ChartUnit)}
                  className="md:hidden"
                />
              )}
            </div>
            {ready && !empty && <NetWorthHeadline summary={data.summary} range={range} masked={privacy.masked} />}
          </div>
          {!empty && (
            <div className="flex flex-col gap-2 md:gap-3">
              <div className="hidden items-center gap-6 md:flex">
                <RangeSelector value={range} onChange={setRange} />
                <SegmentedControl options={UNIT_OPTIONS} value={unit} onChange={(v) => setUnit(v as ChartUnit)} />
              </div>
              <ChartLegend items={legend} className="md:self-end" />
            </div>
          )}
        </div>
        {!empty && <PhoneRangeRow value={range} onChange={setRange} />}
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
        {ready && !empty && data.summary.fxMissing && <ExcludedFootnote count={excluded} className="order-last mt-3" />}
      </div>
    </Surface>
  );
}
