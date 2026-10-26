import type { ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";

import { MaskedMoney } from "./PrivateMoney";
import { excludedText, type Unconverted } from "../lib/fxNote";

const SIZE = {
  lg: "text-[20px] -top-[0.7em]",
  md: "text-[14px] -top-[0.5em]",
  sm: "text-[12px] -top-[0.35em]",
};

/** The amber asterisk on a figure some amount is missing from for want of an
 *  exchange rate. Its card's `FxFootnote` says why; hovering says it too. */
export function FxAsterisk({ title, size = "sm" }: { title: string; size?: keyof typeof SIZE }) {
  return (
    <sup title={title} aria-label={title} className={`relative ml-0.5 cursor-help font-sans text-amber ${SIZE[size]}`}>
      *
    </sup>
  );
}

/** The line under a card that explains its asterisks. */
export function FxFootnote({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`text-fg-faint text-xs ${className}`}>
      <span className="text-amber">*</span> {children}
    </p>
  );
}

/** The footnote of a total that leaves holdings out: the one holding named
 *  with its own-currency value, or how many there are. */
export function ExcludedNote({ items, masked = false }: { items: Unconverted[]; masked?: boolean }) {
  const { t } = useTranslation();
  const one = items.length === 1 ? items[0] : null;
  if (one?.valueNative != null) {
    return (
      <Trans
        i18nKey="fx.excludesOne"
        values={{ name: one.name, currency: one.currency }}
        components={{ value: <MaskedMoney masked={masked} value={one.valueNative} currency={one.currency} /> }}
      />
    );
  }
  return <>{excludedText(t, items)}</>;
}
