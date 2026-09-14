import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff } from "lucide-react";

import { Money } from "./Money";
import { useAuth } from "../auth/context";
import { formatMoney, type MoneyFormatOptions } from "../lib/money";

type PrivateMoneyProps = MoneyFormatOptions & {
  /** Decimal amount as sent by the API (a string), or a number. */
  value: string | number;
  /** Extra classes for size/weight, applied to the amount and the mask alike. */
  className?: string;
};

/** The headline net-worth figure. With private mode off this is exactly a
 *  `Money`. With it on the amount is masked, and the eye reveals it for this
 *  mount only — nothing is persisted, so a reload always comes back masked. */
export function PrivateMoney({ value, className = "", ...options }: PrivateMoneyProps) {
  const { t } = useTranslation();
  const { prefs } = useAuth();
  const [revealed, setRevealed] = useState(false);

  if (!prefs.privateMode) return <Money value={value} className={className} {...options} />;

  const mask = "*".repeat(formatMoney(value, options).length);

  return (
    <span className="flex items-center gap-2">
      {revealed ? (
        <Money value={value} className={className} {...options} />
      ) : (
        <span className={`translate-y-[0.142em] font-mono ${className}`}>{mask}</span>
      )}
      <button
        type="button"
        onClick={() => setRevealed((r) => !r)}
        aria-label={revealed ? t("common.hideAmount") : t("common.showAmount")}
        className="-m-1 cursor-pointer p-3 text-fg-faint transition duration-140 hover:text-fg"
      >
        {revealed ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
      </button>
    </span>
  );
}
