import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";

import { Surface } from "../../Surface";
import { formatMoney } from "../../../lib/money";
import { sliceLabel } from "../../../lib/slice";
import { sankeyGraph, HUB } from "../../../lib/sankeyGraph";
import { GRID, MONO, WHITE, escapeHtml } from "../../../lib/chartTheme";
import type { Sankey } from "../../../api/overview";

export function SankeySurface({
  sankey, onSeeTransactions,
}: {
  sankey: Sankey;
  onSeeTransactions: () => void;
}) {
  const { t } = useTranslation();

  const graph = sankeyGraph(sankey, (s) => sliceLabel(t, s));
  const text = (node: { name: string; label: string }) => {
    if (node.name === HUB) return formatMoney(graph.total);
    // Keyed off `name` (side-prefixed, e.g. "out:notSpent"), not `label`: a
    // real category literally named "notSpent" would otherwise be relabelled
    // (M-T8) — `label` is free-form user text, `name` is the internal id.
    if (node.name === "out:notSpent") return t("budget.overview.sankey.notSpent");
    if (node.name === "in:drawnFromSavings") return t("budget.overview.sankey.drawnFromSavings");
    return node.label;
  };
  const labelByName = new Map(graph.nodes.map((n) => [n.name, text(n)]));

  const option: EChartsOption = {
    backgroundColor: "transparent",
    animationDuration: 300,
    tooltip: {
      trigger: "item",
      backgroundColor: GRID,
      borderWidth: 0,
      padding: [10, 12],
      extraCssText: "border-radius:12px;box-shadow:none;",
      textStyle: { fontFamily: MONO, color: WHITE, fontSize: 12 },
      formatter: (p) => {
        const params = p as unknown as { dataType: string; name: string; value: number; data: { source?: string; target?: string } };
        const name =
          params.dataType === "edge"
            ? labelByName.get(params.data.target === HUB ? params.data.source! : params.data.target!)
            : labelByName.get(params.name);
        // ECharts renders a tooltip formatter's return as innerHTML; the name
        // comes from a category label (user-editable text), so it must be
        // escaped just like `tooltipRow`'s own label (I3).
        return `${escapeHtml(name ?? "")} — ${formatMoney(String(params.value))}`;
      },
    },
    series: [
      {
        type: "sankey",
        left: 8,
        right: 8,
        top: 8,
        bottom: 8,
        nodeGap: 10,
        nodeWidth: 12,
        emphasis: { focus: "adjacency" },
        // Order the payload sent is magnitude order, with `other` last on its
        // side; keeping it means the diagram reads top-down by size.
        layoutIterations: 0,
        data: graph.nodes.map((n) => ({
          name: n.name,
          itemStyle: { color: n.color, borderWidth: 0 },
          label: {
            // Destinations sit on the right edge, so their labels go on the
            // inner side of the bar; on the default outer side they would be
            // clipped by the chart's edge.
            position: n.name.startsWith("out:") ? "left" : "right",
            color: n.color,
            fontFamily: MONO,
            fontSize: 11,
            formatter: () => labelByName.get(n.name) ?? "",
          },
        })),
        links: graph.links.map((l) => ({
          source: l.source,
          target: l.target,
          value: l.value,
          lineStyle: { color: "gradient", opacity: 0.25 },
        })),
      },
    ],
  };

  return (
    <Surface className="w-full">
      <div className="flex flex-col p-5">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-fg font-semibold text-sm">{t("budget.overview.sankey.title")}</h2>
          <button
            type="button"
            data-testid="sankey-see-transactions"
            onClick={onSeeTransactions}
            className="flex cursor-pointer items-center gap-0.5 text-sm text-fg-dim transition-colors duration-140 hover:text-fg"
          >
            {t("budget.overview.sankey.seeTransactions")}
            <ChevronRight className="size-4" />
          </button>
        </div>
        {/* The project's idiom for wide content (holdings, transactions): the
            same diagram, scrolled sideways. Never a distorted phone variant and
            never a coarser truth on a small screen. */}
        <div className="mt-2 overflow-x-auto">
          <div className="min-w-[560px]">
            <ReactECharts option={option} notMerge style={{ height: 380, width: "100%" }} />
          </div>
        </div>
      </div>
    </Surface>
  );
}
