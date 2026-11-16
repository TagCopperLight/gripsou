import type { Sankey, Slice } from "../api/wire";
import { sliceColor, sliceKey } from "./slice";
import { sumDecimals } from "./decimal";
import { FG_FAINT } from "./theme";
import { MINT, ORANGE } from "./palette";

/** The exact decimal string labels and tooltips render, never ECharts' float sums. */
export type SankeyNode = { name: string; label: string; color: string; amount: string };
/** Only drives relative band widths, never a rendered amount. */
export type SankeyLink = { source: string; target: string; value: number };
export type SankeyGraph = { nodes: SankeyNode[]; links: SankeyLink[]; total: string };

export type SankeyLabels = {
  slice: (slice: Slice) => string;
  notSpent: string;
  drawnFromSavings: string;
};

export const HUB = "hub";

/** Sources link into one hub, the hub out to destinations. `notSpent` and
 *  `drawnFromSavings` are in neither server list, so they are added as an extra
 *  destination and source (absent at a remainder of exactly zero). Node names
 *  are side-prefixed because ECharts needs them unique and `uncategorised`
 *  appears on both sides. */
export function sankeyGraph(s: Sankey, labels: SankeyLabels): SankeyGraph {
  const nodes: SankeyNode[] = [];
  const links: SankeyLink[] = [];

  const push = (side: "in" | "out", key: string, text: string, color: string, amount: string) => {
    const name = `${side}:${key}`;
    const value = Number(amount);
    nodes.push({ name, label: text, color, amount });
    links.push(
      side === "in"
        ? { source: name, target: HUB, value }
        : { source: HUB, target: name, value },
    );
  };

  for (const x of s.sources) {
    push("in", sliceKey(x.slice), labels.slice(x.slice), sliceColor(x.slice), x.amount);
  }
  if (s.drawnFromSavings !== undefined) {
    push("in", "drawnFromSavings", labels.drawnFromSavings, ORANGE, s.drawnFromSavings);
  }

  const total = sumDecimals([
    ...s.sources.map((x) => x.amount),
    ...(s.drawnFromSavings !== undefined ? [s.drawnFromSavings] : []),
  ]);

  nodes.push({ name: HUB, label: "", color: FG_FAINT, amount: total });

  for (const x of s.destinations) {
    push("out", sliceKey(x.slice), labels.slice(x.slice), sliceColor(x.slice), x.amount);
  }
  if (s.notSpent !== undefined) {
    push("out", "notSpent", labels.notSpent, MINT, s.notSpent);
  }

  return { nodes, links, total };
}

export function hasFlow(s: Sankey): boolean {
  return (
    s.sources.length > 0 ||
    s.destinations.length > 0 ||
    s.notSpent !== undefined ||
    s.drawnFromSavings !== undefined
  );
}
