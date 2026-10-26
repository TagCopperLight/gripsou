// What a ValueChart draws, worked out apart from the chart so its legend and
// tooltip can't disagree with the lines: the same series, the same colours.

import { windowReturn } from "./assetSeries";

export type ChartUnit = "value" | "reporting" | "percent";

// A line series over a time axis. `area` adds a fading fill; `dashed` renders
// the line dashed (e.g. invested capital).
export type ChartSeries = {
  name: string;
  /** [epoch-ms, value] points. */
  data: [number, number][];
  color: string;
  dashed?: boolean;
  area?: boolean;
};

export const RED = "#f87171"; // color-red

/**
 * The series as plotted. Percent mode with a dashed baseline series (capital
 * invested) plots the ONE thing that means something: return over the displayed
 * window, starting at 0% — profit since the range's start over the capital at
 * work, so deposits don't read as growth. Without a baseline (a unit-price
 * chart) it falls back to change relative to the first point.
 */
export function plotSeries(series: ChartSeries[], unit: ChartUnit, percentLabel?: string): ChartSeries[] {
  if (unit !== "percent") return series;
  const baseline = series.find((s) => s.dashed);
  if (baseline) {
    return series
      .filter((s) => !s.dashed)
      .map((s) => ({ ...s, name: percentLabel ?? s.name, data: windowReturn(s.data, baseline.data) }));
  }
  return series.map((s) => {
    const base = s.data[0]?.[1] ?? 0;
    return { ...s, data: s.data.map(([t, v]) => [t, base ? (v - base) / base : 0] as [number, number]) };
  });
}

/** A tracked value line (the area series) reads red when it ended lower than it
 *  started or went negative: a loss is red whatever colour the caller gave. */
export function lineColor(s: ChartSeries): string {
  const last = s.data.at(-1)?.[1] ?? 0;
  return s.area && (last < 0 || last < (s.data[0]?.[1] ?? 0)) ? RED : s.color;
}

/** Legend entries for plotted series: the main (last drawn) line first. */
export function legendItems(plotted: ChartSeries[]): { label: string; color: string; dashed?: boolean }[] {
  return [...plotted].reverse().map((s) => ({ label: s.name, color: lineColor(s), dashed: s.dashed }));
}
