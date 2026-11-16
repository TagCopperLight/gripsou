import ReactEChartsCore from "echarts-for-react/esm/core";
import type { EChartsReactProps } from "echarts-for-react/esm/types";
import { echarts } from "../lib/echarts";

export default function EChart(props: Omit<EChartsReactProps, "echarts">) {
  return <ReactEChartsCore echarts={echarts} {...props} />;
}
