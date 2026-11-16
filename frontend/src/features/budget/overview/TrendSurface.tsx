import { useMemo } from "react";
import ReactECharts from "../../../ui/EChart";
import type { EChartsOption, EChartsType } from "echarts";
import { useTranslation } from "react-i18next";
import { boneWidths } from "../../../ui/boneWidths";

import { usePhone } from "../../../ui/usePhone";
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
import type { BudgetTrend } from "../../../api/wire";
import { Bone, ChartBone, Skeleton } from "../../../ui/Skeleton";
import { staleClass } from "../../../ui/stale";

type TooltipParam = { dataIndex: number };

const HEIGHT = 300;

type TrendSurfaceProps =
  | {
    trend: BudgetTrend;
    onSelectMonth: (month: string) => void;
    /** Private mode: the tooltip's amounts and the axis are hidden; the bars keep their shape. */
    masked?: boolean;
    stale?: boolean;
  }
  | { trend?: undefined; onSelectMonth?: undefined; masked?: undefined; stale?: undefined };

export function TrendSurface({ trend, onSelectMonth, masked = false, stale = false }: TrendSurfaceProps) {
  const { t } = useTranslation();
  return (
    <Surface className="w-full">
      <div className="flex flex-col p-5">
        <h2 className="text-fg font-semibold text-sm">{t("budget.overview.trend.title")}</h2>
        {trend === undefined ? (
          <>
            <ChartBone style={{ height: HEIGHT }} />
            <Skeleton className="mt-3 flex flex-wrap gap-2">
              {boneWidths(4).map((w) => <Bone key={w} className="h-6 rounded-xl" style={{ width: w * 2.4 }} />)}
            </Skeleton>
          </>
        ) : (
          <div className={staleClass(stale)}>
            <TrendChart trend={trend} onSelectMonth={onSelectMonth} masked={masked} />
            {/* Wraps freely: French labels and renamed categories can be any length. */}
            <div className="mt-3 flex flex-wrap gap-2">
              {trend.series.map((s) => (
                <CategoryChip key={sliceKey(s.slice)} category={sliceChip(t, s.slice)} />
              ))}
            </div>
          </div>
        )}
      </div>
    </Surface>
  );
}

function TrendChart({ trend, onSelectMonth, masked }: {
  trend: BudgetTrend;
  onSelectMonth: (month: string) => void;
  masked: boolean;
}) {
  const { t, i18n } = useTranslation();
  const phone = usePhone();
  const money = (v: string, opts?: MoneyFormatOptions) => formatMaskedMoney(v, masked, opts);

  const language = i18n.language;
  // Each month has its own order: series are stack positions, not categories.
  const columns = useMemo(
    () => trend.months.map((_, dataIndex) =>
      trend.series
        .map((s) => ({ slice: s.slice, amount: s.values[dataIndex] }))
        .sort((a, b) => Number(b.amount) - Number(a.amount)),
    ),
    [trend],
  );

  // Memoised: the option holds closures, so a fresh object each render would reset the chart.
  const option = useMemo<EChartsOption>(() => {
    const short = new Intl.DateTimeFormat(language, { month: "short" });
    const axisLabels = trend.months.map((m) => short.format(monthStart(m)));

    return {
      ...CHART_BASE,
      grid: AXIS_GRID,
      tooltip: chartTooltip("item", (params) => {
        const { dataIndex } = params as TooltipParam;
        // Item hover still shows the whole month's stack. Read the original decimal strings so the total never sums chart floats.
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
      yAxis: valueAxis((v) => money(String(v), { fractionDigits: 0, compact: phone })),
      series: trend.series.map((_, rank) => ({
        name: `rank:${rank}`,
        type: "bar",
        stack: "total",
        data: columns.map((entries) => Number(entries[rank].amount)),
        itemStyle: {
          color: ({ dataIndex }: TooltipParam) => sliceColor(columns[dataIndex][rank].slice),
          // A border in the card's colour spaces the blocks, like the donut's slices (half its width: the bars are narrow).
          borderColor: SURFACE,
          borderWidth: 1,
          borderRadius: 4,
        },
        emphasis: { disabled: true },
        barMaxWidth: 28,
      })),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `money` follows `masked`
  }, [trend, columns, language, t, masked, phone]);

  const onEvents = useMemo(() => {
    // Colours only: rebuilding the React option on every hover would reset this notMerge chart.
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
        // Clear the tooltip position first, or setOption's preservation can reopen it over empty space.
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
    <ReactECharts
      option={option}
      opts={{ renderer: "svg" }}
      notMerge
      onEvents={onEvents}
      style={{ height: HEIGHT, width: "100%" }}
    />
  );
}
