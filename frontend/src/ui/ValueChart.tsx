import ReactECharts from "./EChart";
import type { EChartsOption } from "echarts";
import { formatMoney, formatPercent } from "../lib/money";
import { formatDay } from "../lib/date";
import { lineColor, plotSeries, type ChartSeries, type ChartUnit } from "../lib/valueChart";
import { withAlpha } from "../lib/color";
import { SURFACE_2 } from "../lib/theme";
import { usePhone } from "./usePhone";
import { axisGrid, CHART_BASE, chartTooltip, timeAxis, tooltipCard, tooltipRow, valueAxis } from "../lib/chartTheme";

export type { ChartSeries, ChartUnit };

type TooltipParam = {
  axisValue: number;
  seriesName: string;
  value: [number, number | null];
  color: string;
};

type ValueChartProps = {
  series: ChartSeries[];
  height?: number;
  className?: string;
  /** Painted into the hollow line-symbol centres so they read as cut-out. Defaults to surface-2. */
  surfaceColor?: string;
  unit?: ChartUnit;
  /** Has no effect in percent mode. */
  currency?: string;
  percentLabel?: string;
};

// Callers pass area/solid lines last so they draw on top.
export function ValueChart({
  series,
  height = 320,
  className = "",
  surfaceColor = SURFACE_2,
  unit = "value",
  currency,
  percentLabel,
}: ValueChartProps) {
  const percent = unit === "percent";
  const phone = usePhone();
  const fmt = (v: number, opts?: { fractionDigits?: number; signed?: boolean }) =>
    percent ? formatPercent(v, opts) : formatMoney(v, { ...opts, currency });

  const plotted = plotSeries(series, unit, percentLabel);

  const option: EChartsOption = {
    ...CHART_BASE,
    grid: axisGrid(phone),
    tooltip: chartTooltip("axis", (params) => {
      const items = params as unknown as TooltipParam[];
      // The series itemStyle colour is the hollow centre, i.e. the surface: use the line colour.
      const colorByName = new Map(plotted.map((s) => [s.name, lineColor(s)]));
      // Callers pass the dashed line first for z-order; the tooltip reads better with the value line on top.
      const rows = [...items]
        .reverse()
        .map((it) =>
          tooltipRow(
            colorByName.get(it.seriesName) ?? it.color,
            it.seriesName,
            it.value[1] === null ? "—" : fmt(it.value[1], percent ? { signed: true } : undefined),
          ),
        );
      return tooltipCard(formatDay(items[0].axisValue), rows);
    }),
    xAxis: timeAxis((value) => formatDay(value)),
    yAxis: valueAxis((v) => (percent ? fmt(v, { fractionDigits: 0 }) : formatMoney(v, { currency, fractionDigits: 0, compact: phone })), { scale: true }),
    series: plotted.map((s, i) => {
      const color = lineColor(s);
      return {
        name: s.name,
        type: "line",
        data: s.data,
        showSymbol: false,
        symbol: "circle",
        lineStyle: {
          color,
          width: s.dashed ? 1.5 : 2,
          type: s.dashed ? "dashed" : "solid",
        },
        itemStyle: { color: surfaceColor, borderColor: color, borderWidth: 2 },
        ...(s.area && {
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: withAlpha(color, 0.28) },
                { offset: 1, color: withAlpha(color, 0) },
              ],
            },
          },
        }),
        z: i + 1,
      };
    }),
  };

  return (
    <ReactECharts
      option={option}
      notMerge
      className={className}
      style={{ height, width: "100%" }}
    />
  );
}
