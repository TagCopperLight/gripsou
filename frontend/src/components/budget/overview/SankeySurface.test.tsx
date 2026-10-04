import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { EChartsOption } from "echarts";

import { SankeySurface } from "./SankeySurface";
import { sankeyGraph } from "../../../lib/sankeyGraph";
import type { Sankey } from "../../../api/overview";

// Stands in for the chart so a test can read the option it was handed: jsdom
// cannot draw it, and the labels and tooltips are what is under test.
const rendered: { option?: EChartsOption } = {};
vi.mock("echarts-for-react", () => ({
  default: (props: { option: EChartsOption }) => {
    rendered.option = props.option;
    return <div data-testid="chart-stub" />;
  },
}));

const salary = { slice: { kind: "category" as const, category: {
  id: "i1", name: "Salary", defaultKey: null, color: "#5fcf9e", icon: null,
} }, amount: "3000.00" };

const rent = { slice: { kind: "category" as const, category: {
  id: "e1", name: "Rent", defaultKey: null, color: "#e0605f", icon: null,
} }, amount: "1200.00" };

const LABELS = {
  slice: (s: Sankey["sources"][number]["slice"]) => (s.kind === "category" ? s.category.name : s.kind),
  notSpent: "Not spent",
  drawnFromSavings: "Drawn from savings",
};

function graph(over: Partial<Sankey> = {}) {
  return sankeyGraph({ sources: [salary], destinations: [rent], ...over }, LABELS);
}

describe("sankeyGraph", () => {
  it("routes every source and destination through one hub", () => {
    const g = graph();
    expect(g.nodes.map((n) => n.name)).toEqual(["in:cat:i1", "hub", "out:cat:e1"]);
    expect(g.links).toEqual([
      { source: "in:cat:i1", target: "hub", value: 3000 },
      { source: "hub", target: "out:cat:e1", value: 1200 },
    ]);
  });

  it("adds `not spent` as an extra destination", () => {
    const g = graph({ notSpent: "1800.00" });
    expect(g.nodes.map((n) => n.name)).toContain("out:notSpent");
    expect(g.links).toContainEqual({ source: "hub", target: "out:notSpent", value: 1800 });
  });

  it("adds `drawn from savings` as an extra source", () => {
    const g = graph({ sources: [salary], destinations: [rent], drawnFromSavings: "200.00" });
    expect(g.nodes.map((n) => n.name)).toContain("in:drawnFromSavings");
    expect(g.links).toContainEqual({ source: "in:drawnFromSavings", target: "hub", value: 200 });
  });

  it("draws neither remainder node at a remainder of exactly zero", () => {
    const g = graph();
    expect(g.nodes.map((n) => n.name)).not.toContain("out:notSpent");
    expect(g.nodes.map((n) => n.name)).not.toContain("in:drawnFromSavings");
  });

  it("keeps uncategorised income and uncategorised spending as distinct nodes", () => {
    const g = graph({
      sources: [{ slice: { kind: "uncategorised" }, amount: "400.00" }],
      destinations: [{ slice: { kind: "uncategorised" }, amount: "900.00" }],
    });
    const names = g.nodes.map((n) => n.name);
    expect(names).toContain("in:uncategorised");
    expect(names).toContain("out:uncategorised");
  });

  it("totals the hub over the sources plus any savings drawdown, as an exact decimal string", () => {
    // Never a float sum of a server amount — the hub renders `total`
    // directly through `formatMoney`.
    expect(graph().total).toBe("3000.00");
    expect(graph({ drawnFromSavings: "200.00" }).total).toBe("3200.00");
  });
});

type SeriesNode = { name: string; label: { show: boolean; formatter: () => string } };
type TooltipFormatter = (p: unknown) => string;

function sankeySeries() {
  const series = (rendered.option!.series as { data: SeriesNode[] }[])[0];
  const node = (name: string) => series.data.find((n) => n.name === name)!.label;
  const label = (name: string) => node(name).formatter();
  const tooltip = (rendered.option!.tooltip as { formatter: TooltipFormatter }).formatter;
  return { node, label, tooltip };
}

describe("SankeySurface's node labels", () => {
  it("labels the remainder nodes by their own name, not a category's label", () => {
    // A real category literally named "notSpent" must render its own name,
    // not be swapped for the "not spent" copy meant for the synthetic node.
    const notSpentCategory = {
      slice: {
        kind: "category" as const,
        category: { id: "e2", name: "notSpent", defaultKey: null, color: "#e0605f", icon: null },
      },
      amount: "50.00",
    };
    render(
      <SankeySurface
        sankey={{ sources: [salary], destinations: [rent, notSpentCategory], notSpent: "100.00" }}
        onSeeTransactions={() => {}}
      />,
    );
    const { label } = sankeySeries();
    expect(label("out:cat:e2")).toBe("notSpent");
    expect(label("out:notSpent")).toBe("Not spent");
    expect(label("in:cat:i1")).toBe("Salary");
  });

  it("gives the hub no label, its exact total in its tooltip, and each flow's own decimal", () => {
    render(
      <SankeySurface
        sankey={{
          sources: [
            { ...salary, amount: "0.10" },
            { slice: { kind: "uncategorised" }, amount: "0.20" },
          ],
          destinations: [{ ...rent, amount: "0.30" }],
        }}
        onSeeTransactions={() => {}}
      />,
    );
    const { node, tooltip } = sankeySeries();
    expect(node("hub").show).toBe(false);
    // 0.1 + 0.2 in floats is 0.30000000000000004; the hub shows the decimal sum.
    expect(tooltip({ dataType: "node", name: "hub", data: {} })).toMatch(/0,30/);
    const edge = tooltip({ dataType: "edge", name: "", data: { source: "hub", target: "out:cat:e1" } });
    expect(edge).toContain("Rent");
    expect(edge).toMatch(/0,30/);
  });
});

describe("SankeySurface", () => {
  it("offers the deep link to Transactions", () => {
    const onSeeTransactions = vi.fn();
    render(
      <SankeySurface
        sankey={{ sources: [salary], destinations: [rent] }}
        onSeeTransactions={onSeeTransactions}
      />,
    );
    fireEvent.click(screen.getByTestId("sankey-see-transactions"));
    expect(onSeeTransactions).toHaveBeenCalledTimes(1);
  });
});
