import { useMemo } from "react";
import ReactECharts from "../../../ui/EChart";
import type { EChartsOption, EChartsType } from "echarts";
import { useTranslation } from "react-i18next";

import { Surface } from "../../../ui/Surface";
import { CategoryChip } from "../CategoryChip";
import { desaturate } from "../../../lib/color";
import { formatMaskedMoney, type MoneyFormatOptions } from "../../../lib/money";
import { sumDecimals } from "../../../lib/decimal";
import { monthLabel } from "../../../lib/period";
import { monthStart } from "../../../lib/month";
import { sliceChip, sliceColor, sliceKey, sliceLabel } from "../../../lib/slice";
import { SURFACE } from "../../../lib/theme";
import { AXIS_GRID, CHART_BASE, categoryAxis, chartTooltip, tooltipCard, tooltipRow, valueAxis } from "../../../lib/chartTheme";
import type { BudgetTrend } from "../../../api/overview";

type TooltipParam = { dataIndex: number };

export function TrendSurface({
  trend, onSelectMonth, masked = false,
}: {
  trend: BudgetTrend;
  onSelectMonth: (month: string) => void;
  /** Private mode: the tooltip's amounts and the axis hidden; the bars keep
   *  their shape. */
  masked?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const money = (v: string, opts?: MoneyFormatOptions) => formatMaskedMoney(v, masked, opts);

  const language = i18n.language;
  // Each month has its own order. Series represent stack positions rather
  // than categories, so a category can move up or down between columns.
  const columns = useMemo(
    () => trend.months.map((_, dataIndex) =>
      trend.series
        .map((s) => ({ slice: s.slice, amount: s.values[dataIndex] }))
        .sort((a, b) => Number(b.amount) - Number(a.amount)),
    ),
    [trend],
  );

  // Memoised on the data and the language: the option holds closures, so a
  // fresh object every render would make the chart reset whenever the page
  // re-renders for an unrelated reason.
  const option = useMemo<EChartsOption>(() => {
    const short = new Intl.DateTimeFormat(language, { month: "short" });
    const axisLabels = trend.months.map((m) => short.format(monthStart(m)));

    return {
      ...CHART_BASE,
      grid: AXIS_GRID,
      tooltip: chartTooltip("item", (params) => {
        const { dataIndex } = params as TooltipParam;
        // An item hover still shows the whole month's stack. Read the
        // original decimal strings so the total never sums chart floats.
        const entries = [...columns[dataIndex]]
          .sort((a, b) => Number(a.amount) - Number(b.amount));
        const total = sumDecimals(entries.map((s) => s.amount));
        const rows = entries
          .filter((s) => Number(s.amount) !== 0)
          .map((s) => tooltipRow(sliceColor(s.slice), sliceLabel(t, s.slice), money(s.amount)));
        return tooltipCard(monthLabel(trend.months[dataIndex], language), rows, {
          label: t("common.total"),
          value: money(total),
        });
      }),
      xAxis: categoryAxis(axisLabels),
      yAxis: valueAxis((v) => money(String(v), { fractionDigits: 0 })),
      series: trend.series.map((_, rank) => ({
        name: `rank:${rank}`,
        type: "bar",
        stack: "total",
        data: columns.map((entries) => Number(entries[rank].amount)),
        itemStyle: {
          color: ({ dataIndex }: TooltipParam) => sliceColor(columns[dataIndex][rank].slice),
          // A border in the card's colour spaces the stacked blocks apart,
          // like the donut's slices (half its width: the bars are narrow).
          borderColor: SURFACE,
          borderWidth: 1,
          borderRadius: 4,
        },
        emphasis: { disabled: true },
        barMaxWidth: 28,
      })),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `money` follows `masked`
  }, [trend, columns, language, t, masked]);

  const onEvents = useMemo(() => {
    // Update only the colours: rebuilding the React option on every hover
    // would reset this notMerge chart.
    const colorMonth = (chart: EChartsType, activeIndex: number | null) => {
      chart.setOption({
        series: trend.series.map((_, rank) => ({
          name: `rank:${rank}`,
          itemStyle: {
            color: ({ dataIndex }: TooltipParam) => {
              const color = sliceColor(columns[dataIndex][rank].slice);
              return activeIndex === null || dataIndex === activeIndex
                ? color : desaturate(color, 0.65);
            },
          },
        })),
      });
    };
    return {
      mouseover: (params: TooltipParam, chart: EChartsType) => colorMonth(chart, params.dataIndex),
      mouseout: (_params: unknown, chart: EChartsType) => {
        // Clear the tooltip position before setOption tries to preserve it
        // during the colour update, or it can reopen over empty chart space.
        chart.dispatchAction({ type: "hideTip" });
        colorMonth(chart, null);
      },
      click: (params: unknown) => {
        const { dataIndex } = params as { dataIndex: number };
        const month = trend.months[dataIndex];
        if (month) onSelectMonth(month);
      },
    };
  }, [trend, columns, onSelectMonth]);

  return (
    <Surface className="w-full">
      <div className="flex flex-col p-5">
        <h2 className="text-fg font-semibold text-sm">{t("budget.overview.trend.title")}</h2>
        <ReactECharts
          option={option}
          opts={{ renderer: "svg" }}
          notMerge
          onEvents={onEvents}
          style={{ height: 300, width: "100%" }}
        />
        {/* Wraps freely: French labels run longer and a renamed category can be
            any length, so the legend must never assume a row fits. */}
        <div className="mt-3 flex flex-wrap gap-2">
          {trend.series.map((s) => (
            <CategoryChip key={sliceKey(s.slice)} category={sliceChip(t, s.slice)} />
          ))}
        </div>
      </div>
    </Surface>
  );
}
