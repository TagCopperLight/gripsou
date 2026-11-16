import { useMemo } from "react";
import ReactECharts from "../../../ui/EChart";
import type { EChartsOption } from "echarts";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import { ChartBone } from "../../../ui/Skeleton";

import { Surface } from "../../../ui/Surface";
import { formatMaskedMoney } from "../../../lib/money";
import { sliceLabel } from "../../../lib/slice";
import { sankeyGraph, HUB } from "../../../lib/sankeyGraph";
import { FONT_MONO } from "../../../lib/theme";
import { CHART_BASE, chartTooltip, tooltipRow } from "../../../lib/chartTheme";
import type { Sankey } from "../../../api/wire";
import { LoadingFrame } from "../../../ui/LoadingFrame";
import { staleClass } from "../../../ui/stale";

const HEIGHT = 380;

type SankeySurfaceProps =
  | {
    sankey: Sankey;
    onSeeTransactions: () => void;
    masked?: boolean;
    stale?: boolean;
  }
  | { sankey?: undefined; onSeeTransactions?: undefined; masked?: undefined; stale?: undefined };

export function SankeySurface({ sankey, onSeeTransactions, masked = false, stale = false }: SankeySurfaceProps) {
  const { t } = useTranslation();
  return (
    <Surface className="w-full">
      <LoadingFrame loading={sankey === undefined} className="flex flex-col p-5">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-fg font-semibold text-sm">{t("budget.overview.sankey.title")}</h2>
          <button
            type="button"
            data-testid="sankey-see-transactions"
            onClick={onSeeTransactions}
            className="flex cursor-pointer items-center gap-0.5 text-sm text-fg-dim transition-colors duration-140 enabled:hover:text-fg"
          >
            {t("budget.overview.sankey.seeTransactions")}
            <ChevronRight className="size-4" />
          </button>
        </div>
        {/* Wide content scrolls sideways, as in holdings and transactions, never a distorted phone variant. */}
        <div className={`mt-2 overflow-x-auto ${staleClass(stale)}`}>
          <div className="min-w-[560px]">
            {sankey === undefined ? <ChartBone style={{ height: HEIGHT }} /> : <SankeyChart sankey={sankey} masked={masked} />}
          </div>
        </div>
      </LoadingFrame>
    </Surface>
  );
}

function SankeyChart({ sankey, masked }: { sankey: Sankey; masked: boolean }) {
  const { t } = useTranslation();

  // Memoised: the option holds closures, so a fresh object each render would reset the chart.
  const option = useMemo<EChartsOption>(() => {
    const graph = sankeyGraph(sankey, {
      slice: (s) => sliceLabel(t, s),
      notSpent: t("budget.overview.sankey.notSpent"),
      drawnFromSavings: t("budget.overview.sankey.drawnFromSavings"),
    });
    const byName = new Map(graph.nodes.map((n) => [n.name, n]));

    return {
      ...CHART_BASE,
      tooltip: chartTooltip("item", (p) => {
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
        // The node's own decimal string, never the float ECharts summed.
        return tooltipRow(
          node.name === HUB ? "transparent" : node.color,
          node.name === HUB ? t("common.total") : node.label,
          formatMaskedMoney(node.amount, masked),
          false,
          0,
        );
      }),
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
          // Payload order is magnitude order, `other` last on its side: the diagram reads top-down by size.
          layoutIterations: 0,
          data: graph.nodes.map((n) => ({
            name: n.name,
            itemStyle: { color: n.color, borderWidth: 0 },
            label: {
              // Destination labels go on the inner side: on the outer side the chart's edge would clip them.
              position: n.name.startsWith("out:") ? "left" : "right",
              // The hub has no label: its total is in its tooltip.
              show: n.name !== HUB,
              color: n.color,
              fontFamily: FONT_MONO,
              fontSize: 11,
              formatter: () => n.label,
            },
          })),
          links: graph.links.map((l) => ({
            source: l.source,
            target: l.target,
            value: l.value,
            // Solid category colour: a gradient would fade into the hub's grey.
            lineStyle: {
              color: byName.get(l.target === HUB ? l.source : l.target)?.color,
              opacity: 0.25,
            },
          })),
        },
      ],
    };
  }, [sankey, t, masked]);

  return <ReactECharts option={option} notMerge style={{ height: HEIGHT, width: "100%" }} />;
}
