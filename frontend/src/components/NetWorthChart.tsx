import { ValueChart, type ChartSeries } from "./ValueChart";

const GREEN = "#34d399";
const GRAY = "#777471"; // fg-faint
const SURFACE = "#13110f"; // the dashboard card the chart sits on

/** Chart-facing point: numbers, ready for ECharts. */
export type NetWorthChartPoint = { t: number; netWorth: number; invested: number };

type NetWorthChartProps = {
  data: NetWorthChartPoint[];
  height?: number;
  className?: string;
};

// Net worth (green area) over capital invested (dashed). Thin wrapper around ValueChart.
export function NetWorthChart({ data, height = 320, className = "" }: NetWorthChartProps) {
  const series: ChartSeries[] = [
    { name: "Capital invested", data: data.map((p) => [p.t, p.invested]), color: GRAY, dashed: true },
    { name: "Net worth", data: data.map((p) => [p.t, p.netWorth]), color: GREEN, area: true },
  ];
  return <ValueChart series={series} height={height} className={className} surfaceColor={SURFACE} />;
}
