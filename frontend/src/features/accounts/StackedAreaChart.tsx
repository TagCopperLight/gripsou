import ReactECharts from "../../ui/EChart";
import type { EChartsOption } from "echarts";
import { useTranslation } from "react-i18next";
import { formatMoney } from "../../lib/money";
import { formatDay } from "../../lib/date";
import { withAlpha } from "../../lib/color";
import { FG_FAINT } from "../../lib/theme";
import { AXIS_GRID, CHART_BASE, chartTooltip, timeAxis, tooltipCard, tooltipRow, valueAxis } from "../../lib/chartTheme";

export type StackedSeries = {
  /** What `highlight` names; defaults to the name. */
  key?: string;
  name: string;
  color: string;
  /** [epoch-ms, value] points; all series share the same timestamps. */
  data: [number, number][];
};

type TooltipParam = { axisValue: number; seriesName: string; value: [number, number] };

type StackedAreaChartProps = {
  series: StackedSeries[];
  /** A series to bring forward: the others fade. */
  highlight?: string | null;
  height?: number;
  className?: string;
};

/** One band per account, anchored at zero: a composition. */
export function StackedAreaChart({ series, highlight = null, height = 320, className = "" }: StackedAreaChartProps) {
  const { t } = useTranslation();
  const colorByName = new Map(series.map((s) => [s.name, s.color]));

  const option: EChartsOption = {
    ...CHART_BASE,
    grid: AXIS_GRID,
    tooltip: chartTooltip("axis", (params) => {
      const items = params as unknown as TooltipParam[];
      let total = 0;
      const rows = items.map((it) => {
        total += it.value[1];
        return tooltipRow(colorByName.get(it.seriesName) ?? FG_FAINT, it.seriesName, formatMoney(it.value[1]));
      });
      return tooltipCard(formatDay(items[0].axisValue), rows, { label: t("common.total"), value: formatMoney(total) });
    }),
    xAxis: timeAxis((value) => formatDay(value)),
    yAxis: valueAxis((v) => formatMoney(v, { fractionDigits: 0 }), { min: 0 }),
    series: series.map((s) => {
      const faded = highlight !== null && (s.key ?? s.name) !== highlight;
      return {
        name: s.name,
        type: "line",
        stack: "total",
        data: s.data,
        showSymbol: false,
        lineStyle: { width: 1.5, color: s.color, opacity: faded ? 0.25 : 1 },
        itemStyle: { color: s.color },
        areaStyle: { color: withAlpha(s.color, faded ? 0.1 : 0.55) },
        emphasis: { disabled: true },
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
