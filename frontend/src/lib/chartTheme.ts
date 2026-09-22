// The one copy of the chart palette. These are the resolved values of the
// app's CSS custom properties: ECharts renders to a canvas and cannot read a
// `var(--color-…)`, so the hexes are duplicated here deliberately. Keep them in
// step with the theme tokens named in the comments.

export const GRID = "#262321"; // surface-3
export const FAINT = "#777471"; // fg-faint
export const DIM = "#aeaaa7"; // fg-dim
export const WHITE = "#f4f1ef"; // fg
export const MONO = '"Geist Mono Variable", ui-monospace, monospace';

export function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
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
 *  `"transparent"` as the colour for a swatch-less row (a Total line). */
export function tooltipRow(
  color: string,
  label: string,
  value: string,
  strong = false,
): string {
  const swatch =
    color === "transparent"
      ? ""
      : `<span style="width:9px;height:9px;border-radius:3px;background:${color};"></span>`;
  const labelColor = strong ? WHITE : DIM;
  return `
    <div style="display:flex;align-items:center;gap:8px;margin-top:6px;">
      ${swatch}
      <span style="color:${labelColor};font-size:12px;${strong ? "font-weight:600;" : ""}">${escapeHtml(label)}</span>
      <span style="margin-left:auto;padding-left:12px;color:${WHITE};font-size:12px;font-weight:600;">${value}</span>
    </div>`;
}
