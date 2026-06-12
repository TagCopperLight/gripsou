import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { formatMoney } from "../lib/money";
import { formatDate } from "../lib/date";

// A line series over a time axis. `area` adds a fading fill (matching
// NetWorthChart); `dashed` renders the line dashed (e.g. invested capital).
export type ChartSeries = {
  name: string;
  /** [epoch-ms, value] points. */
  data: [number, number][];
  color: string;
  dashed?: boolean;
  area?: boolean;
};

const GRID = "#262321"; // surface-3
const FAINT = "#777471"; // fg-faint
const DIM = "#aeaaa7"; // fg-dim
const WHITE = "#f4f1ef"; // fg
const SURFACE_2 = "#1c1916"; // default host surface (hollow symbol center)
const MONO = '"Geist Mono Variable", ui-monospace, monospace';

type TooltipParam = {
  axisValue: number;
  seriesName: string;
  value: [number, number];
  color: string;
};

function tooltipRow(color: string, label: string, value: string): string {
  return `
    <div style="display:flex;align-items:center;gap:8px;margin-top:6px;">
      <span style="width:9px;height:9px;border-radius:3px;background:${color};"></span>
      <span style="color:${DIM};font-size:12px;">${label}</span>
      <span style="margin-left:auto;padding-left:12px;color:${WHITE};font-size:12px;font-weight:600;">${value}</span>
    </div>`;
}

type ValueChartProps = {
  series: ChartSeries[];
  height?: number;
  className?: string;
  /**
   * Background the chart sits on; painted into the hollow line-symbol centers so
   * they read as cut-out. Defaults to surface-2; pass the host surface's color.
   */
  surfaceColor?: string;
};

// To draw cleanly on top, area/solid lines should come last; callers pass them
// in the order they want stacked (e.g. dashed invested first, value second).
function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function ValueChart({
  series,
  height = 320,
  className = "",
  surfaceColor = SURFACE_2,
}: ValueChartProps) {
  const option: EChartsOption = {
    backgroundColor: "transparent",
    animationDuration: 600,
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
        const colorByName = new Map(series.map((s) => [s.name, s.color]));
        const rows = items
          .map((it) =>
            tooltipRow(
              colorByName.get(it.seriesName) ?? it.color,
              it.seriesName,
              formatMoney(it.value[1]),
            ),
          )
          .join("");
        return `
          <div style="min-width:200px;">
            <div style="color:${FAINT};font-size:11px;">${formatDate(items[0].axisValue)}</div>
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
        formatter: (value: number) => formatDate(value),
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
        formatter: (v: number) => formatMoney(v, { fractionDigits: 0 }),
      },
    },
    series: series.map((s, i) => ({
      name: s.name,
      type: "line",
      data: s.data,
      showSymbol: false,
      symbol: "circle",
      lineStyle: {
        color: s.color,
        width: s.dashed ? 1.5 : 2,
        type: s.dashed ? "dashed" : "solid",
      },
      itemStyle: { color: surfaceColor, borderColor: s.color, borderWidth: 2 },
      ...(s.area && {
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: rgba(s.color, 0.28) },
              { offset: 1, color: rgba(s.color, 0) },
            ],
          },
        },
      }),
      z: i + 1,
    })),
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
