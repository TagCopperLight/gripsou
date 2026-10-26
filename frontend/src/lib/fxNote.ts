import type { TFunction } from "i18next";
import type { Holding } from "../api/types";

/** A holding left out of every total because its currency has no rate yet,
 *  with what it is worth in that currency. */
export type Unconverted = { name: string; currency: string; valueNative: string | null; accountId: string };

export function unconverted(holdings: Holding[]): Unconverted[] {
  return holdings
    .filter((h) => h.fxMissing)
    .map((h) => ({ name: h.name, currency: h.priceCurrency, valueNative: h.valueNative, accountId: h.accountId }));
}

/** Why a total carries the asterisk, as plain text (the asterisk's tooltip).
 *  One holding is named; several are counted; none known (the list is still
 *  loading, or the total isn't made of holdings) gets the generic reason. */
export function excludedText(t: TFunction, items: Unconverted[]): string {
  if (items.length === 1) {
    return t("fx.excludesOneShort", { name: items[0].name, currency: items[0].currency });
  }
  if (items.length > 1) return t("fx.excludesMany", { count: items.length });
  return t("fx.excludesSome");
}
