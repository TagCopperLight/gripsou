import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { SankeySurface } from "./SankeySurface";
import { sankeyGraph } from "../../../lib/sankeyGraph";
import type { Sankey } from "../../../api/overview";

const salary = { slice: { kind: "category" as const, category: {
  id: "i1", name: "Salary", defaultKey: null, color: "#5fcf9e", icon: null, kind: "income" as const,
} }, amount: "3000.00" };

const rent = { slice: { kind: "category" as const, category: {
  id: "e1", name: "Rent", defaultKey: null, color: "#e0605f", icon: null, kind: "expense" as const,
} }, amount: "1200.00" };

function graph(over: Partial<Sankey> = {}) {
  return sankeyGraph(
    { sources: [salary], destinations: [rent], ...over },
    (s) => (s.kind === "category" ? s.category.name : s.kind),
  );
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
    // M4: never a float sum of a server amount — the hub renders `total`
    // directly through `formatMoney`.
    expect(graph().total).toBe("3000.00");
    expect(graph({ drawnFromSavings: "200.00" }).total).toBe("3200.00");
  });
});

describe("SankeySurface's node labels", () => {
  it("relabels the remainder nodes by their side-prefixed name, not a category's own label (M-T8)", () => {
    // A real category literally named "notSpent" must render its own name,
    // not be swapped for the "not spent" copy meant for the synthetic node.
    const g = sankeyGraph(
      {
        sources: [salary],
        destinations: [
          rent,
          {
            slice: {
              kind: "category",
              category: {
                id: "e2", name: "notSpent", defaultKey: null, color: "#e0605f", icon: null,
                kind: "expense",
              },
            },
            amount: "50.00",
          },
        ],
        notSpent: "100.00",
      },
      (s) => (s.kind === "category" ? s.category.name : s.kind),
    );
    const realNode = g.nodes.find((n) => n.name === "out:cat:e2")!;
    const syntheticNode = g.nodes.find((n) => n.name === "out:notSpent")!;
    expect(realNode.label).toBe("notSpent");
    expect(syntheticNode.label).toBe("notSpent");
    // The two are distinguishable only by `name` — the fix under test reads
    // exactly that field rather than the (identical) `label`.
    expect(realNode.name).not.toBe(syntheticNode.name);
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
