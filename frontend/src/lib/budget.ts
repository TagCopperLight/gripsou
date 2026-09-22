import {
  Activity, ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Banknote, BookOpen, CandlestickChart,
  ChartColumn, CircleDashed, CirclePlus,
  Coins, EyeOff, Film, Fuel, Gamepad2, Gift, GraduationCap, HeartPulse, House, Lamp,
  Landmark, List, PawPrint, Percent, PiggyBank, Plane, PlugZap, Receipt, Repeat, Shield,
  Shirt, ShoppingBag, ShoppingCart, Smartphone, Sparkles, TrainFront, TrendingUp, Undo2,
  Utensils, Wallet, Zap, type LucideIcon
} from "lucide-react";
import type { TFunction } from "i18next";
import type { ReactNode } from "react";

import type { BudgetCategory, BudgetKind } from "../api/budget";
import type { TypeBucket } from "../api/types";
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

/** The TYPE control, shared with the active-filter chips so a bucket looks the
 *  same wherever it appears.
 *
 *  Only the icon carries colour — green for money arriving, red for money
 *  leaving, blue for securities, neutral for `all`, which is the absence of
 *  the filter rather than a fourth kind of row. Selection is drawn in the
 *  panel's own greys, so the colours read as a fixed property of the bucket
 *  and never as "this one is on".
 *
 *  The array order is the 2×2 reading order: `all` and `in` on the top row,
 *  `lots` and `out` beneath them, which puts the scope choices in the left
 *  column and the two cash directions in the right. */
export const TYPE_BUCKETS: { key: TypeBucket; icon: LucideIcon; tint: string }[] = [
  { key: "all", icon: List, tint: "text-fg-faint" },
  { key: "in", icon: ArrowDownLeft, tint: "text-green" },
  { key: "lots", icon: CandlestickChart, tint: "text-blue" },
  { key: "out", icon: ArrowUpRight, tint: "text-red" },
];

/** The OTHERS control, shared with the active-filter chips the same way
 *  `TYPE_BUCKETS` is: plain booleans on `filters`, each one its own on/off.
 *  Both are amber — the colour an uncategorised row and an unreviewed guess
 *  already carry on their chips. */
export const OTHER_FLAGS = [
  {
    key: "uncategorized",
    labelKey: "budget.uncategorized",
    icon: CircleDashed,
    tint: "text-amber",
    strokeWidth: 2,
  },
  // Lucide draws every glyph at stroke 2, which is tuned for open shapes like
  // an arrow. `Sparkles` packs four closed stars into the same box, so at 14px
  // its strokes very nearly meet and the icon reads bold next to its
  // neighbours. Thinning the stroke, not shrinking the icon, is what restores
  // the weight — the glyph keeps its size in the row.
  {
    key: "needsReview",
    labelKey: "budget.needsReview",
    icon: Sparkles,
    tint: "text-amber",
    strokeWidth: 1.5,
  },
] as const;

/** Flag lookup for callers that hold a key and want its icon and colour. */
export const otherFlag = (key: "uncategorized" | "needsReview") =>
  OTHER_FLAGS.find((f) => f.key === key) ?? OTHER_FLAGS[0];

/** Bucket lookup for callers that hold a key and want its icon and colour. */
export const typeBucket = (key: TypeBucket) =>
  TYPE_BUCKETS.find((b) => b.key === key) ?? TYPE_BUCKETS[0];

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
export const FALLBACK_COLOR = "#aeaaa7";
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

/** One line of an `EntityChooser`. `label` is what the search box matches and
 *  what the keyboard reads; `render` is what the line draws (a chip). */
export type ChooserItem = {
  id: string;
  label: string;
  /** A group heading key, or undefined for a flat list. */
  group?: string;
  render: ReactNode;
};
