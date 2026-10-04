import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption, EChartsType } from "echarts";
import { useTranslation } from "react-i18next";

import { Surface } from "../../Surface";
import { CategoryChip } from "../CategoryChip";
import { desaturate } from "../../../lib/color";
import { formatMoney, sumDecimals } from "../../../lib/money";
import { monthLabel, monthStart } from "../../../lib/period";
import { sliceChip, sliceColor, sliceKey, sliceLabel } from "../../../lib/slice";
import { FAINT, GRID, MONO, tooltipRow } from "../../../lib/chartTheme";
import type { BudgetTrend } from "../../../api/overview";

type TooltipParam = { dataIndex: number };

export function TrendSurface({
  trend, onSelectMonth,
}: {
  trend: BudgetTrend;
  onSelectMonth: (month: string) => void;
}) {
  const { t, i18n } = useTranslation();

  const language = i18n.language;

  // Memoised on the data and the language: the option holds closures, so a
  // fresh object every render would make the chart reset and replay its entry
  // animation whenever the page re-renders for an unrelated reason.
  const option = useMemo<EChartsOption>(() => {
    const short = new Intl.DateTimeFormat(language, { month: "short" });
    const axisLabels = trend.months.map((m) => short.format(monthStart(m)));

    return {
      backgroundColor: "transparent",
      animationDuration: 300,
      grid: { top: 16, right: 0, bottom: 24, left: 0, containLabel: true },
      tooltip: {
        trigger: "item",
        backgroundColor: GRID,
        borderWidth: 0,
        padding: [10, 12],
        extraCssText: "border-radius:12px;box-shadow:none;",
        textStyle: { fontFamily: MONO },
        formatter: (params) => {
          const { dataIndex } = params as TooltipParam;
          // An item hover still shows the whole month's stack. Read the
          // original decimal strings so the total never sums chart floats.
          const originals = trend.series.map((s) => s.values[dataIndex]);
          const total = sumDecimals(originals);
          const rows = trend.series
            .map((s, i) =>
              tooltipRow(
                sliceColor(s.slice),
                sliceLabel(t, s.slice),
                formatMoney(originals[i]),
              ),
            )
            .join("");
          const totalRow = tooltipRow(
            "transparent",
            t("common.total"),
            formatMoney(total),
            true,
          );
          return `
            <div style="min-width:200px;">
              <div style="color:${FAINT};font-size:11px;">${monthLabel(
                trend.months[dataIndex],
                language,
              )}</div>
              ${rows}
              <div style="border-top:1px solid ${FAINT};margin-top:8px;padding-top:2px;">${totalRow}</div>
            </div>`;
        },
      },
      xAxis: {
        type: "category",
        data: axisLabels,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: FAINT, fontFamily: MONO, fontSize: 11 },
      },
      yAxis: {
        type: "value",
        splitNumber: 4,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: true, lineStyle: { color: GRID } },
        axisLabel: {
          color: FAINT,
          fontFamily: MONO,
          fontSize: 11,
          formatter: (v: number) => formatMoney(String(v), { fractionDigits: 0 }),
        },
      },
      series: trend.series.map((s) => ({
        // The series name is the slice key, not its label: a renamed category
        // must not restart the animation or break the colour lookup.
        name: sliceKey(s.slice),
        type: "bar",
        stack: "total",
        // Every series has one value per month, zeros included, so the arrays are
        // already aligned — no sparse handling is needed anywhere here.
        data: s.values.map(Number),
        itemStyle: { color: sliceColor(s.slice) },
        emphasis: { disabled: true },
        barMaxWidth: 28,
      })),
    };
  }, [trend, language, t]);

  const onEvents = useMemo(() => {
    // Update only the colours: rebuilding the React option on every hover
    // would reset this notMerge chart and replay its entry animation.
    const colorMonth = (chart: EChartsType, activeIndex: number | null) => {
      chart.setOption({
        series: trend.series.map((s) => {
          const color = sliceColor(s.slice);
          const muted = desaturate(color, 0.65);
          return {
            itemStyle: {
              color: ({ dataIndex }: TooltipParam) =>
                activeIndex === null || dataIndex === activeIndex ? color : muted,
            },
          };
        }),
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
  }, [trend, onSelectMonth]);

  return (
    <Surface className="w-full">
      <div className="flex flex-col p-5">
        <h2 className="text-fg font-semibold text-sm">{t("budget.overview.trend.title")}</h2>
        <ReactECharts
          option={option}
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
