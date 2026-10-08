type Rgb = { r: number; g: number; b: number };
type Hsl = { h: number; s: number; l: number };

function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  const int = parseInt(full, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

function rgbToHex({ r, g, b }: Rgb): string {
  const to = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: h / 6, s, l };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return {
    r: channel(h + 1 / 3) * 255,
    g: channel(h) * 255,
    b: channel(h - 1 / 3) * 255,
  };
}

/**
 * Drain most of a colour's saturation (and dim it slightly) while keeping its
 * hue, so a "greyed" slice still reads as the same colour, just muted.
 * @param amount fraction of saturation to remove (0 = unchanged, 1 = grey).
 */
export function desaturate(hex: string, amount = 0.82, darken = 0.12): string {
  const hsl = rgbToHsl(hexToRgb(hex));
  return rgbToHex(
    hslToRgb({ h: hsl.h, s: hsl.s * (1 - amount), l: hsl.l * (1 - darken) }),
  );
}

/** A hex colour as an `rgba(...)` string at the given alpha (0–1). */
export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** The app's base surface, the ground every tinted chip is designed against. */
const SURFACE = "#13110f";

/**
 * A tint of `hex` flattened into an opaque colour, as if it were painted at
 * `alpha` over the app surface. Chips use this rather than a translucent fill
 * so that whatever the row behind them happens to be — a hover, a green
 * selection — never bleeds through and shifts their hue.
 */
export function tint(hex: string, alpha: number, base = SURFACE): string {
  const c = hexToRgb(hex);
  const b = hexToRgb(base);
  return rgbToHex({
    r: b.r + (c.r - b.r) * alpha,
    g: b.g + (c.g - b.g) * alpha,
    b: b.b + (c.b - b.b) * alpha,
  });
}

/**
 * The `index`-th of `count` shades of `hex`, from a little lighter to a little
 * darker, so children of one slice read as one family (e.g. the countries of a
 * region on the outer ring of a donut). A single child keeps the colour as is.
 */
export function shade(hex: string, index: number, count: number, spread = 0.22): string {
  if (count <= 1) return hex;
  const hsl = rgbToHsl(hexToRgb(hex));
  const l = hsl.l + spread / 2 - (spread * index) / (count - 1);
  return rgbToHex(hslToRgb({ ...hsl, l: Math.min(0.85, Math.max(0.25, l)) }));
}
