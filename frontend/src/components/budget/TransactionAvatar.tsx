import { ArrowDownLeft, ArrowUpRight, Repeat, TrendingUp, type LucideIcon } from "lucide-react";

import { safeBudgetColor } from "../../lib/budget";
import { tint } from "../../lib/color";
import { CategoryIcon } from "./CategoryIcon";
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

/** One size everywhere. A lot shows its instrument's logo, as on the Holdings
 *  card. A categorised row shows its category's glyph (or, for
 *  a category without one, the same coloured dot its chip shows), tinted with
 *  the category colour. Only a row with no category falls back to a neutral
 *  glyph for its kind of movement. */
export function TransactionAvatar({ tx }: { tx: Transaction }) {
  if (tx.source === "lot" && tx.logo?.startsWith("http")) {
    return (
      <span
        data-testid="tx-avatar"
        data-variant="logo"
        style={{ backgroundImage: `url(${tx.logo})` }}
        className="inline-flex size-8 shrink-0 rounded-lg bg-cover bg-center"
      />
    );
  }
  if (tx.categoryId) {
    const color = safeBudgetColor(tx.categoryColor);
    return (
      <span
        data-testid="tx-avatar"
        data-variant="category"
        style={{ color, backgroundColor: tint(color, 0.18) }}
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg"
      >
        <CategoryIcon icon={tx.categoryIcon} className="size-4" />
      </span>
    );
  }
  const Icon = GENERIC_ICONS[genericIconKey(tx)];
  return (
    <span
      data-testid="tx-avatar"
      data-variant="generic"
      // No colour to speak for it, so it sits on the neutral surface with the
      // faint foreground.
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-fg-faint"
    >
      <Icon className="size-4" />
    </span>
  );
}
