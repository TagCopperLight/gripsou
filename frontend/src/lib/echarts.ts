// Importing `echarts` itself bundles every chart type (over half the app's
// JavaScript), so charts use this trimmed build through `ui/EChart.tsx`. A chart
// type or component not registered here renders nothing, without an error.
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart, SankeyChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer, SVGRenderer } from "echarts/renderers";

echarts.use([
  BarChart, LineChart, PieChart, SankeyChart,
  GridComponent, TooltipComponent,
  CanvasRenderer, SVGRenderer,
]);

export { echarts };
