import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";

import { Surface } from "../../Surface";
import { formatMoney } from "../../../lib/money";
import { sliceLabel } from "../../../lib/slice";
import { sankeyGraph, HUB } from "../../../lib/sankeyGraph";
import { GRID, MONO, tooltipRow } from "../../../lib/chartTheme";
import type { Sankey } from "../../../api/overview";

export function SankeySurface({
  sankey, onSeeTransactions,
}: {
  sankey: Sankey;
  onSeeTransactions: () => void;
}) {
  const { t } = useTranslation();

  // Memoised on the data and the translations: the option holds closures, so
  // a fresh object every render would reset the chart and replay its entry
  // animation whenever the page re-renders for an unrelated reason.
  const option = useMemo<EChartsOption>(() => {
    const graph = sankeyGraph(sankey, {
      slice: (s) => sliceLabel(t, s),
      notSpent: t("budget.overview.sankey.notSpent"),
      drawnFromSavings: t("budget.overview.sankey.drawnFromSavings"),
    });
    const byName = new Map(graph.nodes.map((n) => [n.name, n]));

    return {
      backgroundColor: "transparent",
      animationDuration: 300,
      tooltip: {
        trigger: "item",
        backgroundColor: GRID,
        borderWidth: 0,
        padding: [10, 12],
        extraCssText: "border-radius:12px;box-shadow:none;",
        textStyle: { fontFamily: MONO },
        formatter: (p) => {
          const params = p as unknown as {
            dataType: string;
            name: string;
            data: { source?: string; target?: string };
          };
          // A link is described by its non-hub end, which it carries whole.
          const name =
            params.dataType === "edge"
              ? params.data.target === HUB
                ? params.data.source!
                : params.data.target!
              : params.name;
          const node = byName.get(name);
          if (!node) return "";
          // The amount is the node's own decimal string, never the float
          // ECharts summed for it.
          return tooltipRow(
            node.name === HUB ? "transparent" : node.color,
            node.name === HUB ? t("common.total") : node.label,
            formatMoney(node.amount),
            false,
            0,
          );
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
              // The hub has no label: its total is in its tooltip.
              show: n.name !== HUB,
              color: n.color,
              fontFamily: MONO,
              fontSize: 11,
              formatter: () => n.label,
            },
          })),
          links: graph.links.map((l) => ({
            source: l.source,
            target: l.target,
            value: l.value,
            // Solid, in the category's colour (the non-hub end): a gradient
            // would fade every link into the hub's grey in the middle.
            lineStyle: {
              color: byName.get(l.target === HUB ? l.source : l.target)?.color,
              opacity: 0.25,
            },
          })),
        },
      ],
    };
  }, [sankey, t]);

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
