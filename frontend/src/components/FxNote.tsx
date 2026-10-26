import type { ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";

import { MaskedMoney } from "./PrivateMoney";
import { excludedText, type Unconverted } from "../lib/fxNote";

const SIZE = {
  lg: "text-[20px]",
  md: "text-[14px]",
  sm: "text-[12px]",
};

/** The amber asterisk on a figure some amount is missing from for want of an
 *  exchange rate; its card's `FxFootnote` says why. Hangs past the figure's
 *  right edge, so the figure keeps its place: its parent must be `relative`. */
export function FxAsterisk({ size = "sm" }: { size?: keyof typeof SIZE }) {
  return (
    <span aria-hidden className={`absolute top-0 left-full ml-0.5 font-sans leading-none text-amber ${SIZE[size]}`}>
      *
    </span>
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
