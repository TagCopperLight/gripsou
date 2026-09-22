import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { EChartsOption } from "echarts";

import { TrendSurface } from "./TrendSurface";
import type { BudgetTrend } from "../../../api/overview";

// The raw option (functions included — `JSON.stringify` below drops them) so
// the M4 test can invoke the tooltip formatter directly.
let capturedOption: EChartsOption | undefined;

vi.mock("echarts-for-react", () => ({
  // The chart is a canvas; what this test can assert is the option object the
  // component builds and the click handler it wires, so capture both.
  default: (props: { option: EChartsOption; onEvents?: Record<string, (p: unknown) => void> }) => {
    capturedOption = props.option;
    return (
      <button
        data-testid="chart"
        data-option={JSON.stringify(props.option)}
        onClick={() => props.onEvents?.click?.({ dataIndex: 2 })}
      />
    );
  },
}));

const trend: BudgetTrend = {
  months: ["2026-07", "2026-08", "2026-09"],
  series: [
    {
      slice: {
        kind: "category",
        category: { id: "c1", name: "Rent", defaultKey: null, color: "#e0605f", icon: null, kind: "expense" },
      },
      values: ["1200.00", "1200.00", "1200.00"],
    },
    { slice: { kind: "other" }, values: ["140.00", "0.00", "220.00"] },
  ],
};

describe("TrendSurface", () => {
  it("draws one stacked series per slice", () => {
    render(<TrendSurface trend={trend} onSelectMonth={vi.fn()} />);
    const option = JSON.parse(screen.getByTestId("chart").getAttribute("data-option")!);
    expect(option.series).toHaveLength(2);
    expect(option.series.every((s: { stack: string }) => s.stack === "total")).toBe(true);
  });

  it("labels the x axis with the months it was given", () => {
    render(<TrendSurface trend={trend} onSelectMonth={vi.fn()} />);
    const option = JSON.parse(screen.getByTestId("chart").getAttribute("data-option")!);
    expect(option.xAxis.data).toHaveLength(3);
  });

  it("selects the clicked month as the period", () => {
    const onSelectMonth = vi.fn();
    render(<TrendSurface trend={trend} onSelectMonth={onSelectMonth} />);
    screen.getByTestId("chart").click();
    expect(onSelectMonth).toHaveBeenCalledWith("2026-09");
  });

  it("legends every slice with its chip", () => {
    render(<TrendSurface trend={trend} onSelectMonth={vi.fn()} />);
    expect(screen.getAllByTestId("category-chip")).toHaveLength(2);
  });

  it("renders the tooltip total and rows from the series' own decimal strings, not the axis's numbers (M4)", () => {
    render(<TrendSurface trend={trend} onSelectMonth={vi.fn()} />);
    const tooltip = capturedOption!.tooltip;
    const formatter = (Array.isArray(tooltip) ? tooltip[0] : tooltip)!.formatter as (
      params: unknown,
    ) => string;
    // ECharts hands the formatter its own (possibly re-derived) `number`s —
    // deliberately wrong ones here (999) — to prove the rendered amounts come
    // from `trend.series[*].values` at `dataIndex`, never `String(it.value)`.
    const html = formatter([
      { dataIndex: 0, seriesName: "cat:c1", value: 999 },
      { dataIndex: 0, seriesName: "other", value: 999 },
    ]);
    // dataIndex 0 → "1200.00" (Rent) + "140.00" (other) = "1340.00".
    expect(html).toContain("1 340,00");
    expect(html).toContain("1 200,00");
    expect(html).not.toContain("999");
  });
});
