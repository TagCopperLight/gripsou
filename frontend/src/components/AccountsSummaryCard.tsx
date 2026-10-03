import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Surface } from "./Surface";
import { Money } from "./Money";
import { Percent } from "./Percent";
import type { Account } from "../api/types";

type AccountsSummaryCardProps = {
  accounts: Account[];
  className?: string;
};

type Hover = { account: Account; x: number };

/** A bar split by each account's share of the total. Hovering a segment shows
 * a tooltip styled like the charts' (see chartTheme's tooltipRow). */
export function AccountsSummaryCard({ accounts, className = "" }: AccountsSummaryCardProps) {
  const { t } = useTranslation();
  const [hover, setHover] = useState<Hover | null>(null);
  const total = accounts.reduce((sum, a) => sum + Number(a.value), 0);
  const shown = accounts.filter((a) => Number(a.value) > 0);

  return (
    <Surface className={`p-4 md:p-5 ${className}`}>
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-fg font-semibold text-sm">{t("account.allAccounts")}</h2>
        <Money value={total} className="text-fg font-semibold text-sm whitespace-nowrap" />
      </div>
      {total > 0 && (
        <div className="relative mt-3" onMouseLeave={() => setHover(null)}>
          <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
            {shown.map((a) => (
              <span
                key={a.id}
                data-testid="account-share"
                className="h-full min-w-0.5 transition-opacity duration-140"
                style={{
                  flexGrow: Number(a.value),
                  flexBasis: 0,
                  background: a.color,
                  opacity: hover && hover.account.id !== a.id ? 0.4 : 1,
                }}
                onMouseMove={(e) => {
                  const box = e.currentTarget.parentElement!.getBoundingClientRect();
                  setHover({ account: a, x: e.clientX - box.left });
                }}
              />
            ))}
          </div>
          {hover && (
            <div
              role="tooltip"
              className="pointer-events-none absolute bottom-full z-10 mb-2 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-xl bg-surface-3 px-3 py-2 font-mono text-xs"
              style={{ left: hover.x }}
            >
              <span className="flex items-center gap-2">
                <span className="size-2.25 shrink-0 rounded-[3px]" style={{ background: hover.account.color }} />
                <span className="text-fg-dim">{hover.account.name}</span>
              </span>
              <span aria-hidden className="text-fg-faint">·</span>
              <Percent value={Number(hover.account.value) / total} fractionDigits={1} className="text-fg-faint" />
              <span aria-hidden className="text-fg-faint">·</span>
              <Money value={hover.account.value} className="text-fg font-semibold" />
            </div>
          )}
        </div>
      )}
    </Surface>
  );
}
