import {
  Activity, ArrowLeftRight, Banknote, BookOpen, ChartColumn, CircleDashed, CirclePlus,
  Coins, EyeOff, Film, Fuel, Gamepad2, Gift, GraduationCap, HeartPulse, House, Lamp,
  Landmark, PawPrint, Percent, PiggyBank, Plane, PlugZap, Receipt, Repeat, Shield,
  Shirt, ShoppingBag, ShoppingCart, Smartphone, TrainFront, TrendingUp, Undo2,
  Utensils, Wallet, Zap, type LucideIcon
} from "lucide-react";
import type { TFunction } from "i18next";

import type { BudgetCategory, BudgetKind } from "../api/budget";
import { ApiError } from "../api/client";

/** Display order of the four kinds; also the grouping order of every list. */
// Swatches offered in the category/tag colour picker: the account palette's
// hues plus enough extras to fill one row, ordered around the colour wheel.
export const BUDGET_PALETTE: readonly string[] = [
  "#e0605f",
  "#e88a5f",
  "#f0b952",
  "#c9a26b",
  "#8fd05f",
  "#9bb06b",
  "#5fcf9e",
  "#4dd0b1",
  "#55c2d8",
  "#5b9bf0",
  "#6aa0e0",
  "#7f8cf0",
  "#b8a8f0",
  "#b07ef0",
  "#d97ec4",
  "#f08fb0",
  "#9aa4b2",
];

export const BUDGET_KINDS: readonly BudgetKind[] = ["expense", "income", "internal", "excluded"];

/** The page/sidebar glyph, named once so Settings and later phases agree. */
export const BudgetIcon: LucideIcon = ChartColumn;

/** Every icon the seed in `0028_budget.sql` uses plus the rest of the pickable
 *  set, statically imported —
 *  lucide's dynamic index would pull the whole icon set into the bundle. */
export const BUDGET_ICONS: Record<string, LucideIcon> = {
  activity: Activity,
  "arrow-left-right": ArrowLeftRight,
  banknote: Banknote,
  "book-open": BookOpen,
  "circle-dashed": CircleDashed,
  "circle-plus": CirclePlus,
  coins: Coins,
  "eye-off": EyeOff,
  film: Film,
  fuel: Fuel,
  "gamepad-2": Gamepad2,
  gift: Gift,
  "graduation-cap": GraduationCap,
  "heart-pulse": HeartPulse,
  house: House,
  lamp: Lamp,
  landmark: Landmark,
  "paw-print": PawPrint,
  percent: Percent,
  "piggy-bank": PiggyBank,
  plane: Plane,
  "plug-zap": PlugZap,
  receipt: Receipt,
  repeat: Repeat,
  shield: Shield,
  shirt: Shirt,
  "shopping-bag": ShoppingBag,
  "shopping-cart": ShoppingCart,
  smartphone: Smartphone,
  "train-front": TrainFront,
  "trending-up": TrendingUp,
  "undo-2": Undo2,
  utensils: Utensils,
  wallet: Wallet,
  zap: Zap,
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

/** Kind-major, and nothing more: inside a kind the backend's `sort_order` is
 *  the order the user arranged by hand, and `Array.prototype.sort` is stable,
 *  so it survives. */
export function sortCategories(list: BudgetCategory[]): BudgetCategory[] {
  return [...list].sort(
    (a, b) => BUDGET_KINDS.indexOf(a.kind) - BUDGET_KINDS.indexOf(b.kind),
  );
}
