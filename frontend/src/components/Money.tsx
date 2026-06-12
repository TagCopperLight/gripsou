import { formatMoney, type MoneyFormatOptions } from "../lib/money";

type MoneyProps = MoneyFormatOptions & {
  /** Decimal amount as sent by the API (a string), or a number. */
  value: string | number;
  /** Extra classes for size/weight; the mono font is always applied. */
  className?: string;
};

export function Money({ value, className = "", ...options }: MoneyProps) {
  return (
    <span className={`font-mono ${className}`}>{formatMoney(value, options)}</span>
  );
}
