import { describe, it, expect } from "vitest";

import { RED, legendItems, plotSeries, type ChartSeries } from "./valueChart";

const GREEN = "#34d399";
const GRAY = "#777471";

function netWorth(values: number[], invested: number[]): ChartSeries[] {
  return [
    { name: "Invested", data: invested.map((v, i) => [i, v]), color: GRAY, dashed: true },
    { name: "Net worth", data: values.map((v, i) => [i, v]), color: GREEN, area: true },
  ];
}

describe("legendItems", () => {
  it("lists the main line first, in the colour the chart draws it", () => {
    const items = legendItems(plotSeries(netWorth([100, 80], [100, 100]), "value"));
    expect(items).toEqual([
      { label: "Net worth", color: RED, dashed: undefined },
      { label: "Invested", color: GRAY, dashed: true },
    ]);
  });

  it("follows the plotted return in percent mode, not the raw value", () => {
    // The value rose (deposits), but the return over the window is negative:
    // the chart draws a red return line, and the legend must say so too.
    const series = netWorth([100, 150], [100, 160]);
    expect(legendItems(plotSeries(series, "value"))[0].color).toBe(GREEN);
    expect(legendItems(plotSeries(series, "percent", "Return"))).toEqual([
      { label: "Return", color: RED, dashed: undefined },
    ]);
  });
});
