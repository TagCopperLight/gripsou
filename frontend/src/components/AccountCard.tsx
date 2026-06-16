import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, User } from "lucide-react";

import { Surface } from "./Surface";
import { Money } from "./Money";
import { Percent } from "./Percent";
import { EditAccountModal } from "./EditAccountModal";
import { withAlpha } from "../lib/color";
import { formatRelative } from "../lib/date";
import type { Account } from "../api/types";

type AccountCardProps = {
  account: Account;
  /** Share of net worth as a ratio (0–1). */
  proportion: number;
};

export function AccountCard({ account, proportion }: AccountCardProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  return (
    <Surface className="relative p-5">
      <button
        type="button"
        aria-label={t("editAccountModal.title")}
        onClick={() => setEditing(true)}
        className="absolute top-4 right-4 p-2 rounded-lg text-fg-faint hover:bg-surface-2 hover:text-fg transition-colors duration-140 cursor-pointer"
      >
        <Pencil className="size-4" />
      </button>

      <div className="flex gap-3.5">
        <span className="size-8.5 rounded-xl shrink-0 flex items-center justify-center" style={{ background: withAlpha(account.color, 0.3) }}>
          <User className="size-4" style={{ color: account.color }} />
        </span>
        <div className="flex flex-col justify-between h-8.5">
          <p className="text-fg font-semibold text-[15px] leading-none">{account.name}</p>
          <p className="text-fg-faint text-xs leading-none">{account.typeLabel}</p>
        </div>
      </div>

      <div className="mt-5 flex items-baseline gap-1.5 flex-col">
        <span className="text-fg-faint text-xs">{t("account.totalValue")}</span>
        <Money value={account.value} className="text-[22px] font-semibold tracking-tight" />
        <span className="text-fg-faint text-xs">
          <Percent value={proportion} fractionDigits={1} className="text-fg-faint text-xs mr-1.5" />{t("account.ofNetWorth")}
        </span>
      </div>

      <div className="absolute bottom-4 right-5 flex flex-col text-fg-faint text-xs gap-1 items-end">
        <p>{t("account.lastSync")}</p>
        <p className="text-fg text-[13px]">{formatRelative(account.lastSyncAt)}</p>
      </div>

      {editing && (
        <EditAccountModal account={account} onClose={() => setEditing(false)} />
      )}
    </Surface>
  );
}
