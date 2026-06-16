import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { useTranslation } from "react-i18next";
import { formatMoney } from "../lib/money";
import { formatDate } from "../lib/date";

export type StackedSeries = {
  name: string;
  color: string;
  /** [epoch-ms, value] points; all series share the same timestamps. */
  data: [number, number][];
};

const GRID = "#262321"; // surface-3
const FAINT = "#777471"; // fg-faint
const DIM = "#aeaaa7"; // fg-dim
const WHITE = "#f4f1ef"; // fg
const MONO = '"Geist Mono Variable", ui-monospace, monospace';

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function tooltipRow(color: string, label: string, value: string, strong = false): string {
  const swatch = color === "transparent"
    ? ""
    : `<span style="width:9px;height:9px;border-radius:3px;background:${color};"></span>`;
  const labelColor = strong ? WHITE : DIM;
  return `
    <div style="display:flex;align-items:center;gap:8px;margin-top:6px;">
      ${swatch}
      <span style="color:${labelColor};font-size:12px;${strong ? "font-weight:600;" : ""}">${label}</span>
      <span style="margin-left:auto;padding-left:12px;color:${WHITE};font-size:12px;font-weight:600;">${value}</span>
    </div>`;
}

type TooltipParam = { axisValue: number; seriesName: string; value: [number, number] };

type StackedAreaChartProps = {
  series: StackedSeries[];
  height?: number;
  className?: string;
};

// Stacked area, one band per account (account colors). Y anchored at 0 — this is
// a composition. Tooltip lists each account plus a Total row.
export function StackedAreaChart({ series, height = 320, className = "" }: StackedAreaChartProps) {
  const { t } = useTranslation();
  const colorByName = new Map(series.map((s) => [s.name, s.color]));

  const option: EChartsOption = {
    backgroundColor: "transparent",
    animationDuration: 300,
    animationEasing: "cubicOut",
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
        let total = 0;
        const rows = items
          .map((it) => {
            total += it.value[1];
            return tooltipRow(colorByName.get(it.seriesName) ?? FAINT, it.seriesName, formatMoney(it.value[1]));
          })
          .join("");
        const totalRow = tooltipRow("transparent", t("common.total"), formatMoney(total), true);
        return `
          <div style="min-width:200px;">
            <div style="color:${FAINT};font-size:11px;">${formatDate(items[0].axisValue)}</div>
            ${rows}
            <div style="border-top:1px solid ${FAINT};margin-top:8px;padding-top:2px;">${totalRow}</div>
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
      min: 0,
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
    series: series.map((s) => ({
      name: s.name,
      type: "line",
      stack: "total",
      data: s.data,
      showSymbol: false,
      lineStyle: { width: 1.5, color: s.color },
      itemStyle: { color: s.color },
      areaStyle: { color: rgba(s.color, 0.55) },
      emphasis: { disabled: true },
    })),
  };

  const animationKey = series
    .map((s) => `${s.name}:${s.data.length}:${s.data[0]?.[0]}:${s.data.at(-1)?.[0]}`)
    .join("|");

  return (
    <ReactECharts
      key={animationKey}
      option={option}
      notMerge
      className={className}
      style={{ height, width: "100%" }}
    />
  );
}
