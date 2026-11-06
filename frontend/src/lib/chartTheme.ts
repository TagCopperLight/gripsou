// The look every gripsou chart shares: axes, tooltip box and tooltip rows.
import type { TooltipComponentOption, XAXisComponentOption, YAXisComponentOption } from "echarts";

import { FG, FG_DIM, FG_FAINT, FONT_MONO, SURFACE_3 } from "./theme";

export const CHART_BASE = { backgroundColor: "transparent", animation: false } as const;

/** The plot area of an axis chart: edge to edge, the labels inside it. */
export const AXIS_GRID = { top: 16, right: 0, bottom: 24, left: 0, containLabel: true };

const AXIS_LABEL = { color: FG_FAINT, fontFamily: FONT_MONO, fontSize: 11 };
const BARE_AXIS = { axisLine: { show: false }, axisTick: { show: false } };

export function timeAxis(format: (value: number) => string): XAXisComponentOption {
  return {
    type: "time",
    ...BARE_AXIS,
    splitLine: { show: false },
    axisLabel: { ...AXIS_LABEL, hideOverlap: true, formatter: format },
  };
}

export function categoryAxis(data: string[]): XAXisComponentOption {
  return { type: "category", data, ...BARE_AXIS, axisLabel: AXIS_LABEL };
}

/** `min: 0` anchors a composition at zero; `scale` fits the axis to the data. */
export function valueAxis(
  format: (value: number) => string,
  extent: { min?: number; scale?: boolean } = {},
): YAXisComponentOption {
  return {
    type: "value",
    ...extent,
    splitNumber: 4,
    ...BARE_AXIS,
    splitLine: { show: true, lineStyle: { color: SURFACE_3 } },
    axisLabel: { ...AXIS_LABEL, formatter: format },
  };
}

export function chartTooltip(
  trigger: "axis" | "item",
  formatter: TooltipComponentOption["formatter"],
): TooltipComponentOption {
  return {
    trigger,
    backgroundColor: SURFACE_3,
    borderWidth: 0,
    padding: [10, 12],
    extraCssText: "border-radius:12px;box-shadow:none;",
    textStyle: { fontFamily: FONT_MONO },
    ...(trigger === "axis" && { axisPointer: { type: "line", lineStyle: { color: FG_FAINT, width: 1 } } }),
    formatter,
  };
}

/** Escapes text ECharts will drop into tooltip HTML as `innerHTML` — every
 *  label here ultimately comes from user-editable data (a category or tag
 *  name), so an unescaped `<img src=x onerror=…>` would execute. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** One line of a chart tooltip: swatch, label, right-aligned value. Pass
 *  `"transparent"` as the colour for a swatch-less row. A row on its own takes
 *  `marginTop` 0. */
export function tooltipRow(
  color: string,
  label: string,
  value: string,
  strong = false,
  marginTop = 6,
): string {
  const swatch =
    color === "transparent"
      ? ""
      : `<span style="width:9px;height:9px;border-radius:3px;background:${color};"></span>`;
  const labelColor = strong ? FG : FG_DIM;
  return `
    <div style="display:flex;align-items:center;gap:8px;margin-top:${marginTop}px;">
      ${swatch}
      <span style="color:${labelColor};font-size:12px;${strong ? "font-weight:600;" : ""}">${escapeHtml(label)}</span>
      <span style="margin-left:auto;padding-left:12px;color:${FG};font-size:12px;font-weight:600;">${value}</span>
    </div>`;
}

/** A tooltip of rows under a heading (the hovered date), with an optional
 *  total set apart below them. */
export function tooltipCard(
  heading: string,
  rows: string[],
  total?: { label: string; value: string },
): string {
  const totalRow = total
    ? `<div style="border-top:1px solid ${FG_FAINT};margin-top:8px;padding-top:2px;">${tooltipRow("transparent", total.label, total.value, true)}</div>`
    : "";
  return `
    <div style="min-width:200px;">
      <div style="color:${FG_FAINT};font-size:11px;">${escapeHtml(heading)}</div>
      ${rows.join("")}
      ${totalRow}
    </div>`;
}
