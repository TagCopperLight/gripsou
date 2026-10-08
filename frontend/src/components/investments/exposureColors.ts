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
  children?: DonutItem[];
};

/** The leftover slice: neutral, so it never reads as one more category. */
const OTHER_COLOR = "#5a5551";

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
      // The OTHER region (unlisted remainders, unplaced countries) has none.
      children: r.countries.map((c, j) => ({
        key: c.key,
        label: localizeCountry(c.name, lang),
        share: c.share,
        color: shade(color, j, r.countries.length),
      })),
    };
  });
}
