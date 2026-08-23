import { useTranslation } from "react-i18next";

import { HoldingBadge } from "./HoldingBadge";
import { accountTypeLabel, type Holding } from "../api/types";

/** The identity bar shared by `AssetModal` and `RecordLotsModal`. One of them
 *  opens the other, so any difference between the two reads as a glitch. */
export function HoldingModalHeader({
  holding,
  children,
}: {
  holding: Holding;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between p-6">
      <div className="flex items-center gap-4">
        <HoldingBadge
          logo={holding.logo}
          ticker={holding.ticker}
          className="size-12 rounded-xl text-sm"
        />
        <div className="h-12 flex flex-col justify-between py-0.5">
          <h2 className="text-xl font-semibold text-fg leading-none">{holding.name}</h2>
          <div className="flex items-center gap-2 text-sm leading-none">
            <span className="font-mono text-fg-faint">{holding.ticker} · </span>
            <span className="font-mono text-[11px] text-fg-faint bg-surface-3 rounded px-1.5 py-0.5">
              {accountTypeLabel(t, holding.accountType, holding.accountTypeLabel)}
            </span>
            <span className="font-mono text-fg-faint"> · </span>
            <span className="flex items-center gap-1.5 text-fg-dim">
              <span
                className="size-2.5 rounded-sm"
                style={{ background: holding.accountColor }}
              />
              {holding.accountName}
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3">{children}</div>
    </div>
  );
}
