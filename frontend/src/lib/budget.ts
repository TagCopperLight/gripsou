import {
  ArrowLeftRight, ChartPie, CircleDashed, CirclePlus, Coins, EyeOff, Fuel,
  Gamepad2, Gift, GraduationCap, HeartPulse, House, Landmark, Plane, PiggyBank,
  PlugZap, Receipt, Repeat, Shield, ShoppingBag, ShoppingCart, TrainFront,
  TrendingUp, Undo2, Utensils, Wallet, type LucideIcon,
} from "lucide-react";
import type { TFunction } from "i18next";

import type { BudgetCategory, BudgetKind } from "../api/budget";
import { ApiError } from "../api/client";

/** Display order of the four kinds; also the grouping order of every list. */
export const BUDGET_KINDS: readonly BudgetKind[] = ["expense", "income", "internal", "excluded"];

/** The page/sidebar glyph, named once so Settings and later phases agree. */
export const BudgetIcon: LucideIcon = ChartPie;

/** Every icon name the seed in `0028_budget.sql` uses, statically imported —
 *  lucide's dynamic index would pull the whole icon set into the bundle. */
export const BUDGET_ICONS: Record<string, LucideIcon> = {
  "shopping-cart": ShoppingCart,
  utensils: Utensils,
  "train-front": TrainFront,
  fuel: Fuel,
  house: House,
  "plug-zap": PlugZap,
  shield: Shield,
  "heart-pulse": HeartPulse,
  repeat: Repeat,
  "shopping-bag": ShoppingBag,
  "gamepad-2": Gamepad2,
  plane: Plane,
  "graduation-cap": GraduationCap,
  receipt: Receipt,
  landmark: Landmark,
  gift: Gift,
  "circle-dashed": CircleDashed,
  wallet: Wallet,
  coins: Coins,
  "undo-2": Undo2,
  "circle-plus": CirclePlus,
  "arrow-left-right": ArrowLeftRight,
  "piggy-bank": PiggyBank,
  "trending-up": TrendingUp,
  "eye-off": EyeOff,
};

export const BUDGET_ICON_NAMES: readonly string[] = Object.keys(BUDGET_ICONS);

export function budgetIcon(name: string | null): LucideIcon | null {
  return (name && BUDGET_ICONS[name]) || null;
}

/** Grey, from the seeded system row — the fallback for a missing or unsafe
 *  colour. A colour reaches an inline `style`, so it is validated, not trusted. */
const FALLBACK_COLOR = "#aeaaa7";
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function safeBudgetColor(color: string | null | undefined): string {
  return color && HEX.test(color) ? color : FALLBACK_COLOR;
}

/** Seeded rows are translated; a renamed row is the user's own text, shown
 *  verbatim even if it happens to equal a translation key. */
export function categoryLabel(
  t: TFunction,
  c: Pick<BudgetCategory, "name" | "defaultKey">,
): string {
  return c.defaultKey ? t(`budget.defaults.${c.defaultKey}`, { defaultValue: c.name }) : c.name;
}

/** The one place that turns a failed budget write into a translation key.
 *  Branches on `ApiError.status`, never on message text. */
export function budgetErrorKey(err: unknown): "duplicate" | "gone" | "saveError" {
  if (err instanceof ApiError) {
    if (err.status === 409) return "duplicate";
    if (err.status === 404) return "gone";
  }
  return "saveError";
}

/** Kind-major order; `Array.prototype.sort` is stable, so the backend's
 *  `sort_order` inside each kind survives. */
export function sortCategories(list: BudgetCategory[]): BudgetCategory[] {
  return [...list].sort(
    (a, b) => BUDGET_KINDS.indexOf(a.kind) - BUDGET_KINDS.indexOf(b.kind),
  );
}
