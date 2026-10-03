import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Surface } from "./Surface";
import { Money } from "./Money";
import { Percent } from "./Percent";
import { HoldingBadge } from "./HoldingBadge";
import { EditAccountModal } from "./EditAccountModal";
import { formatRelative } from "../lib/date";
import type { ConnectionGroup } from "../lib/accounts";
import { accountTypeLabel, type Account } from "../api/types";

type ConnectionAccountsCardProps = {
  group: ConnectionGroup;
  /** Net worth across every account, for each row's share bar. */
  netWorth: number;
  className?: string;
};

/** One bank connection: its sync time and subtotal, then a row per account.
 * Clicking a row opens the account's edit modal. */
export function ConnectionAccountsCard({ group, netWorth, className = "" }: ConnectionAccountsCardProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<Account | null>(null);
  const name = group.sourceName ?? t("account.unknownSource");

  return (
    <Surface className={`p-4 pb-3.5 md:p-5 md:pb-4.5 ${className}`}>
      <div className="flex items-center gap-2.5 pb-[9.5px]">
        <HoldingBadge
          logo={group.sourceLogo}
          ticker={name}
          className="size-6 rounded-md text-[10px]"
        />
        <h2 className="text-fg font-semibold text-sm truncate">{name}</h2>
        <span aria-hidden className="text-fg-faint text-xs">·</span>
        <span className="text-fg-faint text-xs whitespace-nowrap">
          {group.lastSyncAt === null
            ? t("sync.neverSynced")
            : t("account.synced", { time: formatRelative(group.lastSyncAt) })}
        </span>
        <Money value={group.total} className="ml-auto text-fg font-semibold text-sm whitespace-nowrap" />
      </div>

      {/* Pulled out by the rows' own padding: the hover fill spans the whole
          line while the values stay flush with the bank's subtotal. */}
      <ul className="-mx-2">
        {group.accounts.map((a) => {
          const share = netWorth > 0 ? Number(a.value) / netWorth : 0;
          return (
            <li key={a.id} className="border-t border-surface-2 first:border-t-0">
              <button
                type="button"
                onClick={() => setEditing(a)}
                className="grid w-full cursor-pointer grid-cols-[1fr_auto_auto] items-center gap-3 rounded-lg py-2.5 pr-2 pl-5 text-left transition-colors duration-140 hover:bg-surface-2 md:grid-cols-[1fr_11rem_8rem]"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: a.color }} />
                  <span className="truncate text-fg text-[13px]">{a.name}</span>
                  <span className="hidden text-fg-faint text-xs whitespace-nowrap sm:inline">
                    {accountTypeLabel(t, a.typeKey, a.typeLabel)}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="hidden h-1 flex-1 overflow-hidden rounded-full bg-surface-3 md:block">
                    <span className="block h-full" style={{ width: `${share * 100}%`, background: a.color }} />
                  </span>
                  <Percent value={share} fractionDigits={1} className="w-12 text-right text-fg-faint text-xs" />
                </span>
                <span className="flex items-baseline justify-end gap-1.5">
                  {a.fxMissing && (
                    <span title={t("dashboard.fxMissing")} aria-label={t("dashboard.fxMissing")} className="text-fg-faint text-xs">
                      ⚠
                    </span>
                  )}
                  <Money value={a.value} className="text-fg text-[13px] whitespace-nowrap" />
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {editing && <EditAccountModal account={editing} onClose={() => setEditing(null)} />}
    </Surface>
  );
}
