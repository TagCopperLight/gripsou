import { Pencil } from "lucide-react";

import { Surface } from "./Surface";
import { Money } from "./Money";
import { Percent } from "./Percent";
import { withAlpha } from "../lib/color";
import { formatRelative } from "../lib/date";
import type { Account } from "../api/types";

type AccountCardProps = {
  account: Account;
  /** Share of net worth as a ratio (0–1). */
  proportion: number;
};

export function AccountCard({ account, proportion }: AccountCardProps) {
  return (
    <Surface className="relative p-5">
      <button
        type="button"
        aria-label="Edit account"
        className="absolute top-4 right-4 grid place-items-center size-7 rounded-lg bg-surface-2 text-fg-faint hover:text-fg transition-colors duration-140 cursor-pointer"
      >
        <Pencil className="size-3.5" />
      </button>

      <div className="flex gap-3.5">
        <span
          className="size-11 rounded-xl shrink-0"
          style={{ background: withAlpha(account.color, 0.7) }}
        />
        <div>
          <p className="text-fg font-semibold leading-tight">{account.name}</p>
          <p className="text-fg-dim text-sm mt-0.5">{account.typeLabel}</p>
        </div>
      </div>

      <div className="mt-5 flex items-baseline gap-2 flex-wrap">
        <Money value={account.value} className="text-3xl font-semibold tracking-tight" />
        <span className="text-fg-faint text-sm">·</span>
        <Percent value={proportion} fractionDigits={1} className="text-fg-dim text-sm" />
        <span className="text-fg-faint text-sm">of net worth</span>
      </div>

      <p className="absolute bottom-4 right-5 text-fg-faint text-xs">
        {formatRelative(account.lastSyncAt)}
      </p>
    </Surface>
  );
}
