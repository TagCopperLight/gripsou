import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { EChartsOption } from "echarts";

import { TrendSurface } from "./TrendSurface";
import type { BudgetTrend } from "../../../api/overview";

// The raw option (functions included — `JSON.stringify` below drops them) so
// the decimal-string tooltip test can invoke the tooltip formatter directly.
let capturedOption: EChartsOption | undefined;
type ChartSeries = { data: number[]; itemStyle: { color: (p: { dataIndex: number }) => string } };

let capturedEvents: Record<string, (...args: unknown[]) => void> | undefined;

vi.mock("echarts-for-react", () => ({
  // Capture the chart option and handlers; the tooltip formatter runs here as the
  // real component builds it, while browser checks cover SVG rendering.
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
  it("draws enough stack positions for every slice", () => {
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
    const changing: BudgetTrend = {
      ...trend,
      series: [trend.series[0], { ...trend.series[1], values: ["1300.00", "1200.00", "0.00"] }],
    };
    render(<TrendSurface trend={changing} onSelectMonth={vi.fn()} />);
    const setOption = vi.fn();
    capturedEvents!.mouseover({ dataIndex: 1 }, { setOption });
    const hovered = setOption.mock.calls[0][0].series;
    const originalSeries = capturedOption!.series as unknown as ChartSeries[];
    hovered.forEach((s: { itemStyle: { color: (p: { dataIndex: number }) => string } }, i: number) => {
      const original = originalSeries[i].itemStyle.color({ dataIndex: 1 });
      expect(s.itemStyle.color({ dataIndex: 1 })).toBe(original);
      expect(s.itemStyle.color({ dataIndex: 0 })).not.toBe(originalSeries[i].itemStyle.color({ dataIndex: 0 }));
      expect(s.itemStyle.color({ dataIndex: 2 })).not.toBe(originalSeries[i].itemStyle.color({ dataIndex: 2 }));
    });
    const dispatchAction = vi.fn();
    capturedEvents!.mouseout({}, { setOption, dispatchAction });
    expect(dispatchAction).toHaveBeenCalledWith({ type: "hideTip" });
    const restored = setOption.mock.calls[1][0].series;
    restored.forEach((s: { itemStyle: { color: (p: { dataIndex: number }) => string } }, i: number) => {
      for (let dataIndex = 0; dataIndex < trend.months.length; dataIndex++) {
        expect(s.itemStyle.color({ dataIndex })).toBe(originalSeries[i].itemStyle.color({ dataIndex }));
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

  it("sorts each month's tooltip by ascending amount", () => {
    const changing: BudgetTrend = {
      ...trend,
      series: [trend.series[0], { ...trend.series[1], values: ["1300.00", "1200.00", "0.00"] }],
    };
    render(<TrendSurface trend={changing} onSelectMonth={vi.fn()} />);
    const tooltip = capturedOption!.tooltip;
    const formatter = (Array.isArray(tooltip) ? tooltip[0] : tooltip)!.formatter as (p: unknown) => string;
    const july = formatter({ dataIndex: 0 });
    const august = formatter({ dataIndex: 1 });
    const september = formatter({ dataIndex: 2 });
    expect(july.indexOf("Rent")).toBeLessThan(july.indexOf("Other"));
    // Ties retain the series order; zero categories are omitted.
    expect(august.indexOf("Rent")).toBeLessThan(august.indexOf("Other"));
    expect(september).not.toContain("Other");
    expect(september).toContain("Rent");
    expect(september).toContain("1 200,00");
    expect(july).toContain("2 500,00");

  });

  it("orders each column from largest at the bottom to smallest at the top, keeping category colours", () => {
    const changing: BudgetTrend = {
      ...trend,
      series: [trend.series[0], { ...trend.series[1], values: ["1300.00", "1200.00", "0.00"] }],
    };
    render(<TrendSurface trend={changing} onSelectMonth={vi.fn()} />);
    const series = capturedOption!.series as unknown as ChartSeries[];
    expect(series.map((s) => s.data)).toEqual([[1300, 1200, 1200], [1200, 1200, 0]]);
    // Rent is the top segment in July, but the bottom in September.
    expect(series[1].itemStyle.color({ dataIndex: 0 })).toBe("#e0605f");
    expect(series[0].itemStyle.color({ dataIndex: 2 })).toBe("#e0605f");
    expect(series[1].itemStyle.color({ dataIndex: 2 })).not.toBe("#e0605f");
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
