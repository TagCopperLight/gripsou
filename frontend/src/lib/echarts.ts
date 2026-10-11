// The ECharts parts gripsou draws with. Importing `echarts` itself bundles
// every chart type and component (over half the app's JavaScript), so charts
// go through `components/EChart.tsx`, which hands this trimmed build to
// echarts-for-react. A chart type or option component missing here renders
// nothing, without an error: register it before using it.
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
