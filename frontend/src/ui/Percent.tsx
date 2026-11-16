import { formatPercent, type PercentFormatOptions } from "../lib/money";

type PercentProps = PercentFormatOptions & {
  value: string | number;
  className?: string;
};

export function Percent({ value, className = "", ...options }: PercentProps) {
  return (
    <span className={`font-mono ${className}`}>{formatPercent(value, options)}</span>
  );
}
