// Keys the API takes. Labels are in i18n under `range.short` and `range.over`.

import type { TFunction } from "i18next";
import { RANGES, type Range } from "../api/wire";

export function rangeOptions(t: TFunction): { value: Range; label: string }[] {
  return RANGES.map((r) => ({ value: r, label: t(`range.short.${r}`) }));
}
