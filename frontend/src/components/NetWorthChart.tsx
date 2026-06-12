import { ValueChart, type ChartSeries } from "./ValueChart";
import {
  generateFakeNetWorthData,
  type NetWorthPoint,
} from "../lib/fakeNetWorth";

const GREEN = "#34d399";
const GRAY = "#777471"; // fg-faint
const SURFACE = "#13110f"; // the dashboard card the chart sits on

type NetWorthChartProps = {
  data?: NetWorthPoint[];
  height?: number;
  className?: string;
};

// Net worth (green area) over capital invested (dashed). A thin wrapper around
// ValueChart — all the shared styling lives there.
export function NetWorthChart({
  data = generateFakeNetWorthData(),
  height = 320,
  className = "",
}: NetWorthChartProps) {
  const series: ChartSeries[] = [
    {
      name: "Capital invested",
      data: data.map((p) => [p.t, p.invested]),
      color: GRAY,
      dashed: true,
    },
    {
      name: "Net worth",
      data: data.map((p) => [p.t, p.netWorth]),
      color: GREEN,
      area: true,
    },
  ];

  return (
    <ValueChart
      series={series}
      height={height}
      className={className}
      surfaceColor={SURFACE}
    />
  );
}
