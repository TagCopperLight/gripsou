import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff } from "lucide-react";

import { Money } from "./Money";
import { usePrivacy, type Privacy } from "../auth/usePrivacy";
import { formatMoney, type MoneyFormatOptions } from "../lib/money";

type MaskedMoneyProps = MoneyFormatOptions & {
  /** Decimal amount as sent by the API (a string), or a number. */
  value: string | number;
  masked: boolean;
  /** Extra classes for size/weight, applied to the amount and the mask alike. */
  className?: string;
};

/** An amount, or one asterisk per character of it, so the mask is exactly as
 *  wide as the figure it hides. No eye: a card's figures share one. */
export function MaskedMoney({ value, masked, className = "", ...options }: MaskedMoneyProps) {
  if (!masked) return <Money value={value} className={className} {...options} />;
  return <span className={`translate-y-[0.142em] font-mono ${className}`}>{"*".repeat(formatMoney(value, options).length)}</span>;
}

type PrivateMoneyProps = Omit<MaskedMoneyProps, "masked"> & {
  /** The card's shared privacy, when other figures follow the same eye. */
  privacy?: Privacy;
  /** Hung on the amount's right edge (a footnote's asterisk, which
   *  positions itself against this `relative` wrapper). */
  after?: ReactNode;
};

/** The headline figure. With private mode off this is exactly a `Money`. With
 *  it on the amount is masked, and the eye next to it reveals it. */
export function PrivateMoney({ privacy, after, ...props }: PrivateMoneyProps) {
  const { t } = useTranslation();
  const own = usePrivacy();
  const { enabled, masked, toggle } = privacy ?? own;

  if (!enabled) {
    if (after == null) return <Money {...props} />;
    return (
      <span className="relative">
        <Money {...props} />
        {after}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <span className="relative">
        <MaskedMoney masked={masked} {...props} />
        {after}
      </span>
      <button
        type="button"
        onClick={toggle}
        aria-label={masked ? t("common.showAmount") : t("common.hideAmount")}
        className="-m-1 cursor-pointer p-3 text-fg-faint transition duration-140 hover:text-fg"
      >
        {masked ? <Eye className="size-5" /> : <EyeOff className="size-5" />}
      </button>
    </span>
  );
}
