import {
  Activity, ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Banknote, BookOpen, CandlestickChart,
  CircleDashed, CirclePlus,
  Coins, EyeOff, Film, Fuel, Gamepad2, Gift, GraduationCap, HeartPulse, House, Lamp,
  Landmark, List, PawPrint, Percent, PiggyBank, Plane, PlugZap, Receipt, ReceiptEuro, Repeat, Shield,
  Shirt, ShoppingBag, ShoppingCart, Smartphone, Sparkles, TrainFront, TrendingUp, Undo2,
  Utensils, Wallet, Zap, type LucideIcon
} from "lucide-react";
import type { TypeBucket } from "../../api/wire";

/** The TYPE control, shared with the active-filter chips. The array order is the 2x2 reading order. */
export const TYPE_BUCKETS: { key: TypeBucket; icon: LucideIcon; tint: string }[] = [
  { key: "all", icon: List, tint: "text-fg-faint" },
  { key: "in", icon: ArrowDownLeft, tint: "text-green" },
  { key: "lots", icon: CandlestickChart, tint: "text-blue" },
  { key: "out", icon: ArrowUpRight, tint: "text-red" },
];

/** The OTHERS control, shared with the active-filter chips: plain booleans on `filters`, each its own on/off. */
export const OTHER_FLAGS = [
  {
    key: "uncategorized",
    labelKey: "budget.uncategorized",
    icon: CircleDashed,
    tint: "text-amber",
    strokeWidth: 2,
  },
  // Lucide's stroke 2 makes the four closed stars of `Sparkles` read bold at 14px; a thinner stroke restores the weight.
  {
    key: "needsReview",
    labelKey: "budget.needsReview",
    icon: Sparkles,
    tint: "text-amber",
    strokeWidth: 1.5,
  },
  // Neutral, not amber: it flags nothing.
  {
    key: "transfers",
    labelKey: "budget.transfers",
    icon: ArrowLeftRight,
    tint: "text-fg-dim",
    strokeWidth: 2,
  },
] as const;

export const otherFlag = (key: "uncategorized" | "needsReview" | "transfers") =>
  OTHER_FLAGS.find((f) => f.key === key) ?? OTHER_FLAGS[0];

export const typeBucket = (key: TypeBucket) =>
  TYPE_BUCKETS.find((b) => b.key === key) ?? TYPE_BUCKETS[0];

export const BudgetIcon: LucideIcon = ReceiptEuro;

/** Statically imported: lucide's dynamic index would pull the whole icon set into the bundle. */
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
