import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Surface } from "./Surface";
import { ExcludedNote, FxAsterisk, FxFootnote } from "./FxNote";
import { useConnections, useHoldings } from "../api/hooks";
import { AlertDot } from "./AlertDot";
import { Money } from "./Money";
import { MaskedMoney } from "./PrivateMoney";
import { MoneyHint } from "./MoneyHint";
import { getPrefs } from "../lib/prefs";
import { HoldingBadge } from "./HoldingBadge";
import { EditAccountModal } from "./EditAccountModal";
import { formatShare } from "../lib/distribution";
import { connectionAlert } from "../lib/connectionHealth";
import type { ConnectionGroup } from "../lib/accounts";
import { accountTypeLabel, flattenConnections, type Account } from "../api/types";

type ConnectionAccountsCardProps = {
  group: ConnectionGroup;
  /** What every account owns together (overdrafts left out), for each row's share. */
  owned: number;
  /** The longest type tag on the page, in characters: the tag column's width. */
  tagCh: number;
  /** Private mode, revealed by the summary card's eye. */
  masked: boolean;
  className?: string;
};

/** One bank connection: its subtotal, a dot on its logo when it has a
 * problem (as in the sync window), then a row per account.
 * Clicking a row opens the account's edit modal. */
export function ConnectionAccountsCard({ group, owned, tagCh, masked, className = "" }: ConnectionAccountsCardProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<Account | null>(null);
  const name = group.sourceName ?? t("account.unknownSource");
  const holdings = useHoldings();
  const ids = new Set(group.accounts.map((a) => a.id));
  const connections = useConnections();
  const conn = flattenConnections(connections.data ?? []).find((c) => c.id === group.connectionId);
  const excluded = (holdings.data ?? []).filter((h) => h.fxMissing && ids.has(h.accountId)).length;

  return (
    <Surface className={`p-4 pb-3.5 md:p-5 md:pb-4.5 ${className}`}>
      <div className="flex items-center gap-2.5 pb-[9.5px]">
        <span className="relative shrink-0">
          <HoldingBadge
            logo={group.sourceLogo}
            ticker={name}
            className="size-6 rounded-md text-[10px]"
          />
          <AlertDot alert={conn ? connectionAlert(conn) : null} className="ring-surface" />
        </span>
        <h2 className="text-fg font-semibold text-sm truncate">{name}</h2>
        <MaskedMoney masked={masked} value={group.total} className="ml-auto text-fg font-semibold text-sm whitespace-nowrap" />
      </div>

      {/* Pulled out by the rows' own padding: the hover fill spans the whole
          line while the values stay flush with the bank's subtotal. */}
      <ul className="-mx-2">
        {group.accounts.map((a) => {
          const share = Number(a.value) > 0 ? Number(a.value) / owned : null;
          // A foreign account reads in its own currency, the converted value on hover.
          const native = a.currency !== getPrefs().currency && a.valueNative !== null && !a.fxMissing ? a.valueNative : null;
          return (
            <li key={a.id} className="border-t border-surface-2 first:border-t-0">
              <button
                type="button"
                onClick={() => setEditing(a)}
                className="grid w-full cursor-pointer grid-cols-[1fr_auto_auto] sm:grid-cols-[1fr_auto_auto_auto] items-center gap-3 rounded-lg py-2.5 pr-2 pl-5 text-left transition-colors duration-140 hover:bg-surface-2 md:grid-cols-[1fr_auto_11rem_8rem]"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: a.color }} />
                  <span className="truncate text-fg text-[13px]">{a.name}</span>
                </span>
                {/* Its own column, as wide as the page's longest tag: the tags
                    start at the same place on every row, apart from the bar. */}
                <span className="hidden box-content pr-1 text-[11px] sm:block" style={{ width: `calc(${tagCh}ch + 1rem)` }}>
                  <span className="rounded-md px-2 py-0.5 bg-surface-3 text-fg-faint whitespace-nowrap">
                    {accountTypeLabel(t, a.typeKey)}
                  </span>
                </span>
                {/* No share (overdrawn, or at zero): the amount alone, as on the dashboard. */}
                <span className="flex items-center gap-3">
                  {share !== null && (
                    <>
                      <span className="hidden h-1 flex-1 overflow-hidden rounded-full bg-surface-3 md:block">
                        <span className="block h-full" style={{ width: `${share * 100}%`, background: a.color }} />
                      </span>
                      <span className="ml-auto w-12 text-right font-mono text-fg-faint text-xs">{formatShare(share, 1)}</span>
                    </>
                  )}
                </span>
                <span className="relative text-right whitespace-nowrap">
                  {masked ? (
                    <MaskedMoney masked value={native ?? a.value} currency={native !== null ? a.currency : undefined} className="text-fg text-[13px] whitespace-nowrap" />
                  ) : native !== null ? (
                    <MoneyHint hint={<Money value={a.value} />}>
                      <Money value={native} currency={a.currency} className="text-fg text-[13px] whitespace-nowrap" />
                    </MoneyHint>
                  ) : (
                    <Money value={a.value} className={`${Number(a.value) < 0 ? "text-red" : "text-fg"} text-[13px] whitespace-nowrap`} />
                  )}
                  {a.fxMissing && <FxAsterisk />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {group.accounts.some((a) => a.fxMissing) && (
        <FxFootnote className="mt-2 px-0.5">
          <ExcludedNote count={excluded} />
        </FxFootnote>
      )}

      {editing && <EditAccountModal account={editing} onClose={() => setEditing(null)} />}
    </Surface>
  );
}
