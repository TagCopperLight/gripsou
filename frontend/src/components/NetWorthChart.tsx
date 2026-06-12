import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { formatMoney } from "../lib/money";
import { formatDate } from "../lib/date";
import {
  generateFakeNetWorthData,
  type NetWorthPoint,
} from "../lib/fakeNetWorth";

const GREEN = "#34d399";
const GRID = "#262321"; // surface-3
const GRAY = "#777471"; // fg-faint
const FAINT = "#777471"; // fg-faint
const DIM = "#aeaaa7"; // fg-dim
const WHITE = "#f4f1ef"; // fg
const SURFACE = "#13110f"; // surface (chart sits on it; hollow symbol center)
const MONO = '"Geist Mono Variable", ui-monospace, monospace';

type TooltipParam = {
  axisValue: number;
  seriesName: string;
  value: [number, number];
};

function tooltipRow(color: string, label: string, value: string): string {
  return `
    <div style="display:flex;align-items:center;gap:8px;margin-top:6px;">
      <span style="width:9px;height:9px;border-radius:3px;background:${color};"></span>
      <span style="color:${DIM};font-size:12px;">${label}</span>
      <span style="margin-left:auto;padding-left:12px;color:${WHITE};font-size:12px;font-weight:600;">${value}</span>
    </div>`;
}

type NetWorthChartProps = {
  data?: NetWorthPoint[];
  height?: number;
  className?: string;
};

export function NetWorthChart({
  data = generateFakeNetWorthData(),
  height = 320,
  className = "",
}: NetWorthChartProps) {
  const netWorth = data.map((p) => [p.t, p.netWorth]);
  const invested = data.map((p) => [p.t, p.invested]);

  const option: EChartsOption = {
    backgroundColor: "transparent",
    animationDuration: 600,
    grid: { top: 16, right: 0, bottom: 24, left: 0, containLabel: true },
    tooltip: {
      trigger: "axis",
      backgroundColor: GRID, // surface-3
      borderWidth: 0,
      padding: [10, 12],
      extraCssText: "border-radius:12px;box-shadow:none;",
      textStyle: { fontFamily: MONO },
      axisPointer: { type: "line", lineStyle: { color: FAINT, width: 1 } },
      formatter: (params) => {
        const items = params as unknown as TooltipParam[];
        const byName = (name: string) =>
          items.find((i) => i.seriesName === name)?.value[1];
        const netWorthValue = byName("Net worth");
        const investedValue = byName("Capital invested");
        return `
          <div style="min-width:200px;">
            <div style="color:${FAINT};font-size:11px;">${formatDate(items[0].axisValue)}</div>
            ${netWorthValue !== undefined ? tooltipRow(GREEN, "Net worth", formatMoney(netWorthValue)) : ""}
            ${investedValue !== undefined ? tooltipRow(GRAY, "Capital Invested", formatMoney(investedValue)) : ""}
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
    series: [
      {
        name: "Capital invested",
        type: "line",
        data: invested,
        showSymbol: false,
        symbol: "circle",
        lineStyle: { color: GRAY, width: 1.5, type: "dashed" },
        itemStyle: { color: SURFACE, borderColor: GRAY, borderWidth: 2 },
        z: 1,
      },
      {
        name: "Net worth",
        type: "line",
        data: netWorth,
        showSymbol: false,
        symbol: "circle",
        smooth: false,
        lineStyle: { color: GREEN, width: 2 },
        itemStyle: { color: SURFACE, borderColor: GREEN, borderWidth: 2 },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(52, 211, 153, 0.28)" },
              { offset: 1, color: "rgba(52, 211, 153, 0)" },
            ],
          },
        },
        z: 2,
      },
    ],
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
