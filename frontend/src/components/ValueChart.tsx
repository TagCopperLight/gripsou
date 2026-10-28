import ReactECharts from "./EChart";
import type { EChartsOption } from "echarts";
import { formatMoney, formatPercent } from "../lib/money";
import { formatDay } from "../lib/date";
import { lineColor, plotSeries, type ChartSeries, type ChartUnit } from "../lib/valueChart";
import { FAINT, GRID, MONO, rgba, tooltipRow } from "../lib/chartTheme";

export type { ChartSeries, ChartUnit };

const SURFACE_2 = "#1c1916"; // default host surface (hollow symbol center)

type TooltipParam = {
  axisValue: number;
  seriesName: string;
  value: [number, number];
  color: string;
};

type ValueChartProps = {
  series: ChartSeries[];
  height?: number;
  className?: string;
  /**
   * Background the chart sits on; painted into the hollow line-symbol centers so
   * they read as cut-out. Defaults to surface-2; pass the host surface's color.
   */
  surfaceColor?: string;
  /**
   * "value" plots raw amounts (money axis); "percent" plots each series' change
   * relative to its first point in the range (percent axis). Defaults to value.
   */
  unit?: ChartUnit;
  /**
   * ISO code to format money values in (e.g. a native unit-price series).
   * Defaults to the user's reporting currency. Has no effect in percent mode.
   */
  currency?: string;
  /** Series name shown in percent mode when a baseline turns it into a return. */
  percentLabel?: string;
};

// To draw cleanly on top, area/solid lines should come last; callers pass them
// in the order they want stacked (e.g. dashed invested first, value second).
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
  const fmt = (v: number, opts?: { fractionDigits?: number; signed?: boolean }) =>
    percent ? formatPercent(v, opts) : formatMoney(v, { ...opts, currency });

  const plotted = plotSeries(series, unit, percentLabel);

  const option: EChartsOption = {
    backgroundColor: "transparent",
    animation: false,
    grid: { top: 16, right: 0, bottom: 24, left: 0, containLabel: true },
    tooltip: {
      trigger: "axis",
      backgroundColor: GRID,
      borderWidth: 0,
      padding: [10, 12],
      extraCssText: "border-radius:12px;box-shadow:none;",
      textStyle: { fontFamily: MONO },
      axisPointer: { type: "line", lineStyle: { color: FAINT, width: 1 } },
      formatter: (params) => {
        const items = params as unknown as TooltipParam[];
        // The series itemStyle color is the (hollow) symbol center, i.e. the
        // surface — use the real line color from the series for the marker.
        const colorByName = new Map(plotted.map((s) => [s.name, lineColor(s)]));
        // ponytail: callers pass the dashed invested line first for z-order;
        // the tooltip reads better with the bigger value line on top.
        const rows = [...items]
          .reverse()
          .map((it) =>
            tooltipRow(
              colorByName.get(it.seriesName) ?? it.color,
              it.seriesName,
              fmt(it.value[1], percent ? { signed: true } : undefined),
            ),
          )
          .join("");
        return `
          <div style="min-width:200px;">
            <div style="color:${FAINT};font-size:11px;">${formatDay(items[0].axisValue)}</div>
            ${rows}
          </div>`;
      },
    },
    xAxis: {
      type: "time",
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: {
        color: FAINT,
        fontFamily: MONO,
        fontSize: 11,
        hideOverlap: true,
        formatter: (value: number) => formatDay(value),
      },
    },
    yAxis: {
      type: "value",
      scale: true,
      splitNumber: 4,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: true, lineStyle: { color: GRID } },
      axisLabel: {
        color: FAINT,
        fontFamily: MONO,
        fontSize: 11,
        formatter: (v: number) => fmt(v, { fractionDigits: 0 }),
      },
    },
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
                { offset: 0, color: rgba(color, 0.28) },
                { offset: 1, color: rgba(color, 0) },
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
