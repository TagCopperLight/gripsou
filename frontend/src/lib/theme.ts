// The theme's tokens as literal values, for what cannot read a `var(--…)`:
// ECharts draws to a canvas, and a colour mixed into a tint or an alpha needs
// its hex. They are read from the stylesheet's `@theme` block, the one place
// they are written.
import css from "../index.css?raw";

function token(name: string): string {
  const value = new RegExp(`\\s--${name}:\\s*([^;]+);`).exec(css)?.[1].trim();
  if (!value) throw new Error(`index.css defines no --${name}`);
  return value;
}

export const SURFACE = token("color-surface");
export const SURFACE_2 = token("color-surface-2");
export const SURFACE_3 = token("color-surface-3");
export const FG = token("color-fg");
export const FG_DIM = token("color-fg-dim");
export const FG_FAINT = token("color-fg-faint");
export const GREEN = token("color-green");
export const RED = token("color-red");
export const AMBER = token("color-amber");
export const FONT_MONO = token("font-mono");
