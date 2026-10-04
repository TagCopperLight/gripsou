import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { EChartsOption } from "echarts";

import { TrendSurface } from "./TrendSurface";
import type { BudgetTrend } from "../../../api/overview";

// The raw option (functions included — `JSON.stringify` below drops them) so
// the decimal-string tooltip test can invoke the tooltip formatter directly.
let capturedOption: EChartsOption | undefined;
let capturedEvents: Record<string, (...args: unknown[]) => void> | undefined;

vi.mock("echarts-for-react", () => ({
  // The chart is a canvas; what this test can assert is the option object the
  // component builds and the click handler it wires, so capture both.
  default: (props: { option: EChartsOption; onEvents?: Record<string, (...args: unknown[]) => void> }) => {
    capturedOption = props.option;
    capturedEvents = props.onEvents;
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
        category: { id: "c1", name: "Rent", defaultKey: null, color: "#e0605f", icon: null },
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

  it("only triggers the tooltip on bar items", () => {
    render(<TrendSurface trend={trend} onSelectMonth={vi.fn()} />);
    const option = JSON.parse(screen.getByTestId("chart").getAttribute("data-option")!);
    expect(option.tooltip.trigger).toBe("item");
  });

  it("mutes other months across every slice and restores their colours on leave", () => {
    render(<TrendSurface trend={trend} onSelectMonth={vi.fn()} />);
    const setOption = vi.fn();
    capturedEvents!.mouseover({ dataIndex: 1 }, { setOption });
    const hovered = setOption.mock.calls[0][0].series;
    const option = JSON.parse(screen.getByTestId("chart").getAttribute("data-option")!);
    hovered.forEach((s: { itemStyle: { color: (p: { dataIndex: number }) => string } }, i: number) => {
      const original = option.series[i].itemStyle.color;
      expect(s.itemStyle.color({ dataIndex: 1 })).toBe(original);
      expect(s.itemStyle.color({ dataIndex: 0 })).not.toBe(original);
      expect(s.itemStyle.color({ dataIndex: 2 })).not.toBe(original);
    });
    const dispatchAction = vi.fn();
    capturedEvents!.mouseout({}, { setOption, dispatchAction });
    expect(dispatchAction).toHaveBeenCalledWith({ type: "hideTip" });
    const restored = setOption.mock.calls[1][0].series;
    restored.forEach((s: { itemStyle: { color: (p: { dataIndex: number }) => string } }, i: number) => {
      for (let dataIndex = 0; dataIndex < trend.months.length; dataIndex++) {
        expect(s.itemStyle.color({ dataIndex })).toBe(option.series[i].itemStyle.color);
      }
    });
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

  it("renders the tooltip total and rows from the series' own decimal strings, not the hovered segment's number", () => {
    render(<TrendSurface trend={trend} onSelectMonth={vi.fn()} />);
    const tooltip = capturedOption!.tooltip;
    const formatter = (Array.isArray(tooltip) ? tooltip[0] : tooltip)!.formatter as (
      params: unknown,
    ) => string;
    // ECharts hands the formatter its own (possibly re-derived) `number`s —
    // deliberately wrong ones here (999) — to prove the rendered amounts come
    // from `trend.series[*].values` at `dataIndex`, never `String(it.value)`.
    const html = formatter({ dataIndex: 0, seriesName: "other", value: 999 });
    // Hovering Other must also include Rent. dataIndex 0 → "1200.00" (Rent) + "140.00" (other) = "1340.00".
    expect(html).toContain("1 340,00");
    expect(html).toContain("1 200,00");
    expect(html).not.toContain("999");
  });
});
