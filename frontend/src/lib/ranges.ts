// The chart ranges, by the keys the API takes. One list for every range picker;
// their labels live in i18n under `range.short` (buttons) and `range.over`
// (the "over 6 months" next to a gain).

import type { TFunction } from "i18next";

export const RANGES = ["7d", "1mo", "6mo", "1y", "ytd", "max"] as const;
export type Range = (typeof RANGES)[number];

export function rangeOptions(t: TFunction): { value: Range; label: string }[] {
  return RANGES.map((r) => ({ value: r, label: t(`range.short.${r}`) }));
}
