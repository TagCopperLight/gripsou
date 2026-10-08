import type { TFunction } from "i18next";

import { ACCOUNT_PALETTE } from "../../lib/palette";
import { shade } from "../../lib/color";
import { localizeCountry, localizeSector } from "../../lib/composition-i18n";
import { OTHER, type RegionSlice, type Slice } from "../../lib/exposure";

export type DonutItem = {
  key: string;
  label: string;
  share: number;
  color: string;
  /** The leftover slice, drawn striped so it never reads as one more category. */
  other?: boolean;
  children?: DonutItem[];
};

/** Fallback for the striped leftover where a pattern can't be drawn. */
const OTHER_COLOR = "#5d5955";

// Past the palette's end, a darker pass keeps neighbours from sharing a colour.
const colorAt = (i: number) => {
  const base = ACCOUNT_PALETTE[i % ACCOUNT_PALETTE.length];
  return i < ACCOUNT_PALETTE.length ? base : shade(base, 1, 2, 0.3);
};

/** Slices as donut items, coloured in order, OTHER in grey. */
export function flatItems(slices: Slice[], label: (s: Slice) => string): DonutItem[] {
  return slices.map((s, i) => ({
    key: s.key,
    label: label(s),
    share: s.share,
    color: s.key === OTHER ? OTHER_COLOR : colorAt(i),
    other: s.key === OTHER,
  }));
}

export function sectorItems(slices: Slice[], t: TFunction): DonutItem[] {
  return flatItems(slices, (s) =>
    s.key === OTHER ? t("investments.exposure.other") : localizeSector(s.name, t),
  );
}

export function holdingItems(slices: Slice[]): DonutItem[] {
  return flatItems(slices, (s) => s.name);
}

/** Regions, each with its countries in shades of the region's colour. */
export function regionItems(regions: RegionSlice[], t: TFunction, lang: string): DonutItem[] {
  return regions.map((r, i) => {
    const color = r.key === OTHER ? OTHER_COLOR : colorAt(i);
    return {
      key: r.key,
      label: t(`investments.regions.${r.key}`),
      share: r.share,
      color,
      other: r.key === OTHER,
      // The OTHER region (unlisted remainders, unplaced countries) has none.
      children: r.countries.map((c, j) => ({
        key: c.key,
        label: c.key === OTHER ? t("investments.exposure.other") : localizeCountry(c.name, lang),
        share: c.share,
        color: c.key === OTHER ? OTHER_COLOR : shade(color, j, r.countries.length),
        other: c.key === OTHER,
      })),
    };
  });
}

// The leftover's 45° stripes: 2px light, 2px dark. Dimmed, both go darker so
// the slice greys out with the others on hover.
const STRIPES = { light: "#5d5955", dark: "#2e2b28" };
const STRIPES_DIM = { light: "#3a3734", dark: "#1f1d1b" };

/** The stripes as CSS, for legend swatches. */
export function stripeCss(dim = false): string {
  const c = dim ? STRIPES_DIM : STRIPES;
  return `repeating-linear-gradient(45deg, ${c.light} 0 2px, ${c.dark} 2px 4px)`;
}

const patterns = new Map<boolean, HTMLCanvasElement>();

/** The stripes as an ECharts pattern fill. A 6px tile repeats seamlessly at
 *  45° (a stripe period of ~4px), drawn at the screen's pixel density. */
export function stripePattern(dim = false) {
  let tile = patterns.get(dim);
  if (!tile) {
    const dpr = window.devicePixelRatio || 1;
    const size = 6;
    tile = document.createElement("canvas");
    tile.width = tile.height = size * dpr;
    const ctx = tile.getContext("2d");
    if (ctx) {
      const c = dim ? STRIPES_DIM : STRIPES;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = c.dark;
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = c.light;
      ctx.lineWidth = size / Math.SQRT2 / 2;
      for (const k of [0, size, size * 2]) {
        ctx.beginPath();
        // Top-left to bottom-right, like the CSS gradient's stripes.
        ctx.moveTo(k - size - 1, -1);
        ctx.lineTo(k + 1, size + 1);
        ctx.stroke();
      }
    }
    patterns.set(dim, tile);
  }
  const dpr = window.devicePixelRatio || 1;
  return { image: tile, repeat: "repeat" as const, scaleX: 1 / dpr, scaleY: 1 / dpr };
}
