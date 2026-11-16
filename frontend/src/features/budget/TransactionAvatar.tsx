import { ArrowDownLeft, ArrowUpRight, Repeat, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";

import { safeBudgetColor } from "../../lib/budget";
import { logoUrl } from "../../lib/logo";
import { tint } from "../../lib/color";
import { CategoryIcon } from "./CategoryIcon";
import type { Transaction } from "../../api/wire";

/** Indexed, not called, to satisfy `react-hooks/static-components`. */
const GENERIC_ICONS: Record<"lot" | "sale" | "transfer" | "out" | "in", LucideIcon> = {
  lot: TrendingUp,
  sale: TrendingDown,
  transfer: Repeat,
  out: ArrowUpRight,
  in: ArrowDownLeft,
};

function genericIconKey(tx: Transaction): keyof typeof GENERIC_ICONS {
  if (tx.source === "lot") return tx.type === "sell" ? "sale" : "lot";
  if (tx.isTransfer) return "transfer";
  return tx.amount.trim().startsWith("-") ? "out" : "in";
}

export function TransactionAvatar({ tx }: { tx: Transaction }) {
  const logo = tx.source === "lot" ? logoUrl(tx.logo) : null;
  if (logo) {
    return (
      <span
        data-testid="tx-avatar"
        style={{ backgroundImage: `url(${logo})` }}
        className="inline-flex size-8 shrink-0 rounded-lg bg-cover bg-center"
      />
    );
  }
  if (tx.categoryId) {
    const color = safeBudgetColor(tx.categoryColor);
    return (
      <span
        data-testid="tx-avatar"
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
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-fg-faint"
    >
      <Icon className="size-4" />
    </span>
  );
}
