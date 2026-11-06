import ReactEChartsCore from "echarts-for-react/esm/core";
import type { EChartsReactProps } from "echarts-for-react/esm/types";
import { echarts } from "../lib/echarts";

/** echarts-for-react bound to the trimmed ECharts build in `lib/echarts.ts`. */
export default function EChart(props: Omit<EChartsReactProps, "echarts">) {
  return <ReactEChartsCore echarts={echarts} {...props} />;
}
