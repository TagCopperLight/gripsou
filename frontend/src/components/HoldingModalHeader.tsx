import { useTranslation } from "react-i18next";

import { HoldingBadge } from "./HoldingBadge";
import { accountTypeLabel, type Holding } from "../api/types";

/** The identity bar shared by `AssetModal` and `RecordLotsModal`. One of them
 *  opens the other, so any difference between the two reads as a glitch. */
export function HoldingModalHeader({
  holding,
  afterName,
  children,
}: {
  holding: Holding;
  /** Right after the name: the window's private-mode eye. */
  afterName?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-4 p-4 md:p-6">
      <div className="flex min-w-0 items-center gap-4">
        <HoldingBadge
          logo={holding.logo}
          ticker={holding.ticker}
          className="size-12 rounded-xl text-sm"
        />
        <div className="flex h-12 min-w-0 flex-col justify-between py-0.5">
          <h2 className="flex items-center gap-3 text-xl font-semibold text-fg leading-none">
            <span className="truncate">{holding.name}</span>
            {afterName}
          </h2>
          <div className="flex min-w-0 items-center gap-2 whitespace-nowrap text-sm leading-none">
            <span className="font-mono text-fg-faint">{holding.ticker} · </span>
            <span className="font-mono text-[11px] text-fg-faint bg-surface-3 rounded px-1.5 py-0.5">
              {accountTypeLabel(t, holding.accountType)}
            </span>
            <span className="font-mono text-fg-faint"> · </span>
            <span className="flex min-w-0 items-center gap-1.5 text-fg-dim">
              <span
                className="size-2.5 shrink-0 rounded-sm"
                style={{ background: holding.accountColor }}
              />
              <span className="truncate">{holding.accountName}</span>
            </span>
          </div>
        </div>
      </div>
      <div className="ml-auto flex items-center gap-3">{children}</div>
    </div>
  );
}
