import {
  Activity, ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Banknote, BookOpen, CandlestickChart,
  CircleDashed, CirclePlus,
  Coins, EyeOff, Film, Fuel, Gamepad2, Gift, GraduationCap, HeartPulse, House, Lamp,
  Landmark, List, PawPrint, Percent, PiggyBank, Plane, PlugZap, Receipt, ReceiptEuro, Repeat, Shield,
  Shirt, ShoppingBag, ShoppingCart, Smartphone, Sparkles, TrainFront, TrendingUp, Undo2,
  Utensils, Wallet, Zap, type LucideIcon
} from "lucide-react";
import type { TypeBucket } from "../../api/wire";

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
  // Not amber: this one flags nothing needing attention, it only widens the
  // list back to rows hidden by default. Neutral, like the `all` bucket.
  {
    key: "transfers",
    labelKey: "budget.transfers",
    icon: ArrowLeftRight,
    tint: "text-fg-dim",
    strokeWidth: 2,
  },
] as const;

/** Flag lookup for callers that hold a key and want its icon and colour. */
export const otherFlag = (key: "uncategorized" | "needsReview" | "transfers") =>
  OTHER_FLAGS.find((f) => f.key === key) ?? OTHER_FLAGS[0];

/** Bucket lookup for callers that hold a key and want its icon and colour. */
export const typeBucket = (key: TypeBucket) =>
  TYPE_BUCKETS.find((b) => b.key === key) ?? TYPE_BUCKETS[0];

/** The page/sidebar glyph, named once so every place showing it agrees. */
export const BudgetIcon: LucideIcon = ReceiptEuro;

/** Every icon the category seed uses plus the rest of the pickable set,
 *  statically imported: lucide's dynamic index would pull the whole icon set
 *  into the bundle. */
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
