import type { Sankey, Slice } from "../api/overview";
import { sliceColor, sliceKey } from "./slice";
import { sumDecimals } from "./money";
import { FAINT } from "./chartTheme";

export type SankeyNode = { name: string; label: string; color: string };
export type SankeyLink = { source: string; target: string; value: number };
/** `total` is the exact decimal string the hub renders (never a float sum —
 *  see CLAUDE.md); ECharts link `value`s may stay `number`, since they only
 *  drive relative bar widths rather than a rendered amount. */
export type SankeyGraph = { nodes: SankeyNode[]; links: SankeyLink[]; total: string };

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
export function sankeyGraph(s: Sankey, label: (slice: Slice) => string): SankeyGraph {
  const nodes: SankeyNode[] = [];
  const links: SankeyLink[] = [];

  const push = (side: "in" | "out", key: string, text: string, color: string, value: number) => {
    const name = `${side}:${key}`;
    nodes.push({ name, label: text, color });
    links.push(
      side === "in"
        ? { source: name, target: HUB, value }
        : { source: HUB, target: name, value },
    );
  };

  for (const x of s.sources) {
    push("in", sliceKey(x.slice), label(x.slice), sliceColor(x.slice), Number(x.amount));
  }
  if (s.drawnFromSavings !== undefined) {
    push("in", "drawnFromSavings", "drawnFromSavings", DRAWN_COLOR, Number(s.drawnFromSavings));
  }

  const total = sumDecimals([
    ...s.sources.map((x) => x.amount),
    ...(s.drawnFromSavings !== undefined ? [s.drawnFromSavings] : []),
  ]);

  // The hub sits between the two sides, so it is inserted after every source
  // and before every destination.
  nodes.push({ name: HUB, label: "", color: FAINT });

  for (const x of s.destinations) {
    push("out", sliceKey(x.slice), label(x.slice), sliceColor(x.slice), Number(x.amount));
  }
  if (s.notSpent !== undefined) {
    push("out", "notSpent", "notSpent", NOT_SPENT_COLOR, Number(s.notSpent));
  }

  return { nodes, links, total };
}
