import type { Sankey, Slice } from "../api/overview";
import { sliceColor, sliceKey } from "./slice";
import { sumDecimals } from "./money";
import { FAINT } from "./chartTheme";

/** `amount` is the exact decimal string a node's label and tooltip render —
 *  never ECharts' own float sums. Each non-hub node has exactly one link, so
 *  its amount is also its link's. */
export type SankeyNode = { name: string; label: string; color: string; amount: string };
/** `value` may stay a `number`: it only drives relative band widths, never a
 *  rendered amount. */
export type SankeyLink = { source: string; target: string; value: number };
/** `total` is the hub's amount: the exact decimal sum of everything in. */
export type SankeyGraph = { nodes: SankeyNode[]; links: SankeyLink[]; total: string };

/** Every node's text: a slice's label, plus the two nodes that are not slices. */
export type SankeyLabels = {
  slice: (slice: Slice) => string;
  notSpent: string;
  drawnFromSavings: string;
};

export const HUB = "hub";
/** Green and orange, matching the two singleton slices they sit beside. */
export const NOT_SPENT_COLOR = "#5fcf9e";
export const DRAWN_COLOR = "#e88a5f";

/** Turn the payload into an ECharts sankey graph.
 *
 *  Every source links into one hub and the hub links out to every destination.
 *  Source-to-destination links are NOT drawn: nothing in the data says which
 *  euro of salary paid the rent, so their weights would be invented.
 *
 *  `notSpent` and `drawnFromSavings` appear in neither list the server sends —
 *  they live only in their own fields — so they are added here, as an extra
 *  destination and an extra source respectively. At a remainder of exactly zero
 *  neither is present: three states, not two.
 *
 *  Node names are side-prefixed because ECharts requires them unique and
 *  `uncategorised` legitimately appears on both sides. */
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
    push("in", "drawnFromSavings", labels.drawnFromSavings, DRAWN_COLOR, s.drawnFromSavings);
  }

  const total = sumDecimals([
    ...s.sources.map((x) => x.amount),
    ...(s.drawnFromSavings !== undefined ? [s.drawnFromSavings] : []),
  ]);

  // The hub sits between the two sides, so it is inserted after every source
  // and before every destination.
  nodes.push({ name: HUB, label: "", color: FAINT, amount: total });

  for (const x of s.destinations) {
    push("out", sliceKey(x.slice), labels.slice(x.slice), sliceColor(x.slice), x.amount);
  }
  if (s.notSpent !== undefined) {
    push("out", "notSpent", labels.notSpent, NOT_SPENT_COLOR, s.notSpent);
  }

  return { nodes, links, total };
}

/** Whether the period moved any money the diagram can draw. A period whose
 *  only rows net out (money moved back from savings, say) has none, and would
 *  otherwise draw a lone zero hub. */
export function hasFlow(s: Sankey): boolean {
  return (
    s.sources.length > 0 ||
    s.destinations.length > 0 ||
    s.notSpent !== undefined ||
    s.drawnFromSavings !== undefined
  );
}
