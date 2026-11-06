import type { ReactNode } from "react";

import { Money } from "./Money";
import { usePrefs } from "../auth/context";

/** An amount in `currency`, with the same figure in the reader's currency
 *  (`converted`) in a small bubble beside it while it is hovered; the hand
 *  cursor says there is one. No bubble when the amount already is in the
 *  reader's currency, or when there is no converted figure. CSS-only (no
 *  state), so a long list of rows pays no re-render for it. */
export function MoneyHint({ currency, converted, signed = false, side = "left", children }: {
  currency: string;
  converted: string | number | null | undefined;
  signed?: boolean;
  side?: "left" | "right";
  children: ReactNode;
}) {
  const reader = usePrefs().currency;
  if (converted == null || currency === reader) return children;
  return (
    <span className="group/hint relative cursor-pointer">
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute top-1/2 z-10 hidden h-6 -translate-y-1/2 items-center justify-center whitespace-nowrap rounded-[6px] bg-surface-3 px-2.25 font-mono text-xs font-normal text-fg group-hover/hint:flex ${
          side === "left" ? "right-full mr-2.5" : "left-full ml-2.5"
        }`}
      >
        <Money value={converted} signed={signed} />
      </span>
    </span>
  );
}
