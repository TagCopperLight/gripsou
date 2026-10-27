import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Surface } from "./Surface";
import { MaskedMoney, PrivacyEye } from "./PrivateMoney";
import { Percent } from "./Percent";
import type { Account } from "../api/types";
import type { Privacy } from "../auth/usePrivacy";

type AccountsSummaryCardProps = {
  accounts: Account[];
  /** Shared with the bank cards below: this card's eye reveals them all. */
  privacy: Privacy;
  onHover?: (accountId: string | null) => void;
  className?: string;
};

/** `x` is the pointer's position across the bar, from 0 (left) to 1 (right). */
type Hover = { account: Account; x: number };

/** A bar split by each account's share of the total. Hovering a segment shows
 * a tooltip styled like the charts' (see chartTheme's tooltipRow). */
export function AccountsSummaryCard({ accounts, privacy, onHover, className = "" }: AccountsSummaryCardProps) {
  const { t } = useTranslation();
  const [hover, setHover] = useState<Hover | null>(null);
  const total = accounts.reduce((sum, a) => sum + Number(a.value), 0);
  const shown = accounts.filter((a) => Number(a.value) > 0);

  return (
    <Surface className={`p-4 md:p-5 ${className}`}>
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-fg font-semibold text-sm">
          {t("account.allAccounts")}
          {privacy.enabled && (
            <span className="ml-3 inline-flex align-middle">
              <PrivacyEye size="sm" masked={privacy.masked} toggle={privacy.toggle} />
            </span>
          )}
        </h2>
        <MaskedMoney masked={privacy.masked} value={total} className="text-fg font-semibold text-sm whitespace-nowrap" />
      </div>
      {total > 0 && (
        <div className="relative mt-3" onMouseLeave={() => {
          setHover(null);
          onHover?.(null);
        }}>
          <div className="flex h-2.5 gap-1">
            {shown.map((a) => (
              <span
                key={a.id}
                data-testid="account-share"
                className="h-full min-w-1 rounded-full transition-opacity duration-140"
                style={{
                  flexGrow: Number(a.value),
                  flexBasis: 0,
                  background: a.color,
                  opacity: hover && hover.account.id !== a.id ? 0.4 : 1,
                }}
                onMouseMove={(e) => {
                  const box = e.currentTarget.parentElement!.getBoundingClientRect();
                  setHover({ account: a, x: (e.clientX - box.left) / box.width });
                  if (hover?.account.id !== a.id) onHover?.(a.id);
                }}
              />
            ))}
          </div>
          {hover && (
            <div
              role="tooltip"
              className="pointer-events-none absolute bottom-full z-10 mb-2 flex items-center gap-2 whitespace-nowrap rounded-xl bg-surface-3 px-3 py-2 font-mono text-xs"
              // Slides under the pointer from left-aligned at the bar's left end to
              // right-aligned at its right end, so it never leaves the card.
              style={{ left: `${hover.x * 100}%`, transform: `translateX(${-hover.x * 100}%)` }}
            >
              <span className="flex items-center gap-2">
                <span className="size-2.25 shrink-0 rounded-[3px]" style={{ background: hover.account.color }} />
                <span className="text-fg-dim">{hover.account.name}</span>
              </span>
              <span aria-hidden className="text-fg-faint">·</span>
              <Percent value={Number(hover.account.value) / total} fractionDigits={1} className="text-fg-faint" />
              <span aria-hidden className="text-fg-faint">·</span>
              <MaskedMoney masked={privacy.masked} value={hover.account.value} className="text-fg font-semibold" />
            </div>
          )}
        </div>
      )}
    </Surface>
  );
}
