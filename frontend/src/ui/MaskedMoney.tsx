import { useTranslation } from "react-i18next";
import { Eye, EyeOff } from "lucide-react";

import { Money } from "./Money";
import type { Privacy } from "../auth/usePrivacy";
import { formatMaskedMoney, type MoneyFormatOptions } from "../lib/money";

type MaskedMoneyProps = MoneyFormatOptions & {
  value: string | number;
  masked: boolean;
  className?: string;
};

export function MaskedMoney({ value, masked, className = "", ...options }: MaskedMoneyProps) {
  if (!masked) return <Money value={value} className={className} {...options} />;
  return <span className={`translate-y-[0.142em] font-mono ${className}`}>{formatMaskedMoney(value, true, options)}</span>;
}

export function PrivacyEye({ masked, toggle }: Pick<Privacy, "masked" | "toggle">) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={masked ? t("common.showAmount") : t("common.hideAmount")}
      className="-m-2 inline-flex cursor-pointer p-2 text-fg-faint transition duration-140 hover:text-fg"
    >
      {masked ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
    </button>
  );
}
