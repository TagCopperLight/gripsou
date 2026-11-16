import { formatMoney, type MoneyFormatOptions } from "../lib/money";

type MoneyProps = MoneyFormatOptions & {
  value: string | number;
  className?: string;
};

export function Money({ value, className = "", ...options }: MoneyProps) {
  return (
    <span className={`font-mono ${className}`}>{formatMoney(value, options)}</span>
  );
}
