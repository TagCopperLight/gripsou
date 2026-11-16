// Worked out apart from the chart so legend and tooltip agree with the lines.

import { windowReturn } from "./assetSeries";
import { RED } from "./theme";

export type ChartUnit = "value" | "reporting" | "percent";

export type ChartSeries = {
  name: string;
  /** A `null` value is a day with no figure: ECharts draws a gap. */
  data: [number, number | null][];
  color: string;
  dashed?: boolean;
  area?: boolean;
};

export function numberOrNull(v: string | null): number | null {
  return v === null ? null : Number(v);
}

/** Percent mode with a dashed baseline (capital invested) plots return over the
 *  window from 0%, so deposits don't read as growth. Without a baseline it is
 *  change relative to the first point. */
export function plotSeries(series: ChartSeries[], unit: ChartUnit, percentLabel?: string): ChartSeries[] {
  if (unit !== "percent") return series;
  const baseline = series.find((s) => s.dashed);
  if (baseline) {
    return series
      .filter((s) => !s.dashed)
      .map((s) => ({ ...s, name: percentLabel ?? s.name, data: windowReturn(s.data, baseline.data) }));
  }
  return series.map((s) => {
    const base = firstValue(s) ?? 0;
    return {
      ...s,
      name: percentLabel ?? s.name,
      data: s.data.map(([t, v]) => [t, v === null ? null : base ? (v - base) / base : 0] as [number, number | null]),
    };
  });
}

function firstValue(s: ChartSeries): number | null {
  return s.data.find(([, v]) => v !== null)?.[1] ?? null;
}

function lastValue(s: ChartSeries): number | null {
  return s.data.findLast(([, v]) => v !== null)?.[1] ?? null;
}

/** Red when it ended lower than it started or went negative, whatever colour the caller gave. */
export function lineColor(s: ChartSeries): string {
  const last = lastValue(s) ?? 0;
  return s.area && (last < 0 || last < (firstValue(s) ?? 0)) ? RED : s.color;
}

export function legendItems(plotted: ChartSeries[]): { label: string; color: string; dashed?: boolean }[] {
  return [...plotted].reverse().map((s) => ({ label: s.name, color: lineColor(s), dashed: s.dashed }));
}
