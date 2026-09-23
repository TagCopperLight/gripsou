import { ArrowDownLeft, ArrowUpRight, Repeat, TrendingUp, type LucideIcon } from "lucide-react";

import { BUDGET_ICONS, FALLBACK_COLOR, safeBudgetColor } from "../../lib/budget";
import { tint } from "../../lib/color";
import type { Transaction } from "../../api/types";

/** Last resort glyphs, keyed by kind of movement — a static record, indexed
 *  (not called), so the icon resolution stays lint-clean under
 *  `react-hooks/static-components`. */
const GENERIC_ICONS: Record<"lot" | "transfer" | "out" | "in", LucideIcon> = {
  lot: TrendingUp,
  transfer: Repeat,
  out: ArrowUpRight,
  in: ArrowDownLeft,
};

/** Which generic glyph applies, when nothing else is known. */
function genericIconKey(tx: Transaction): keyof typeof GENERIC_ICONS {
  if (tx.source === "lot") return "lot";
  if (tx.isTransfer) return "transfer";
  return tx.amount.trim().startsWith("-") ? "out" : "in";
}

/** §2.3's two-step fallback, at one size everywhere:
 *  1. the category's icon, tinted with the category colour;
 *  2. a generic glyph for the transaction type. */
export function TransactionAvatar({ tx }: { tx: Transaction }) {
  const CategoryIcon = (tx.categoryIcon && BUDGET_ICONS[tx.categoryIcon]) || null;
  const hasCategory = Boolean(tx.categoryId && CategoryIcon);
  const Icon = hasCategory && CategoryIcon ? CategoryIcon : GENERIC_ICONS[genericIconKey(tx)];
  const color = hasCategory ? safeBudgetColor(tx.categoryColor) : FALLBACK_COLOR;

  return (
    <span
      data-testid="tx-avatar"
      data-variant={hasCategory ? "category" : "generic"}
      // A categorised row's avatar is tinted with its category colour; an
      // uncategorised one has no colour to speak for it, so it sits on the
      // neutral surface with the faint foreground.
      style={hasCategory ? { color, backgroundColor: tint(color, 0.18) } : undefined}
      className={`inline-flex size-8 shrink-0 items-center justify-center rounded-lg ${
        hasCategory ? "" : "bg-surface-2 text-fg-faint"
      }`}
    >
      <Icon className="size-4" />
    </span>
  );
}
