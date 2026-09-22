import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { useTranslation } from "react-i18next";

import { Surface } from "../../Surface";
import { CategoryChip } from "../CategoryChip";
import { formatMoney } from "../../../lib/money";
import { monthLabel } from "../../../lib/period";
import { sliceChip, sliceColor, sliceKey, sliceLabel } from "../../../lib/slice";
import { sumDecimals } from "../../../lib/money";
import { FAINT, GRID, MONO, tooltipRow } from "../../../lib/chartTheme";
import type { BudgetTrend } from "../../../api/overview";

type TooltipParam = { dataIndex: number; seriesName: string; value: number };

export function TrendSurface({
  trend, onSelectMonth,
}: {
  trend: BudgetTrend;
  onSelectMonth: (month: string) => void;
}) {
  const { t, i18n } = useTranslation();

  const short = new Intl.DateTimeFormat(i18n.language, { month: "short" });
  const axisLabels = trend.months.map((m) => {
    const [y, mm] = m.split("-");
    return short.format(new Date(Number(y), Number(mm) - 1, 1));
  });

  const colorByName = new Map(trend.series.map((s) => [sliceKey(s.slice), sliceColor(s.slice)]));
  const labelByName = new Map(trend.series.map((s) => [sliceKey(s.slice), sliceLabel(t, s.slice)]));
  // The tooltip renders the server's own decimal strings (never a float sum
  // of them — M4): `it.value` has already gone through ECharts as a
  // `number`, so `String(it.value)` would lose whatever precision that round
  // trip cost.
  const valuesByName = new Map(trend.series.map((s) => [sliceKey(s.slice), s.values]));

  const option: EChartsOption = {
    backgroundColor: "transparent",
    animationDuration: 300,
    grid: { top: 16, right: 0, bottom: 24, left: 0, containLabel: true },
    tooltip: {
      trigger: "axis",
      backgroundColor: GRID,
      borderWidth: 0,
      padding: [10, 12],
      extraCssText: "border-radius:12px;box-shadow:none;",
      textStyle: { fontFamily: MONO },
      axisPointer: { type: "shadow" },
      formatter: (params) => {
        const items = params as unknown as TooltipParam[];
        const dataIndex = items[0]?.dataIndex ?? 0;
        const originals = items.map(
          (it) => valuesByName.get(it.seriesName)?.[dataIndex] ?? String(it.value),
        );
        const total = sumDecimals(originals);
        const rows = items
          .map((it, i) =>
            tooltipRow(
              colorByName.get(it.seriesName) ?? FAINT,
              labelByName.get(it.seriesName) ?? it.seriesName,
              formatMoney(originals[i]),
            ),
          )
          .join("");
        const totalRow = tooltipRow(
          "transparent",
          t("budget.overview.trend.total"),
          formatMoney(total),
          true,
        );
        return `
          <div style="min-width:200px;">
            <div style="color:${FAINT};font-size:11px;">${monthLabel(
              trend.months[items[0].dataIndex],
              i18n.language,
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
      barMaxWidth: 28,
    })),
  };

  const onEvents = {
    click: (params: unknown) => {
      const { dataIndex } = params as { dataIndex: number };
      const month = trend.months[dataIndex];
      if (month) onSelectMonth(month);
    },
  };

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
