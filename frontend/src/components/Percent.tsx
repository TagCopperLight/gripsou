import { formatPercent, type PercentFormatOptions } from "../lib/money";

type PercentProps = PercentFormatOptions & {
  /** Ratio as sent by the API (0.025 → "2,5 %"); a string or number. */
  value: string | number;
  /** Extra classes for size/weight; the mono font is always applied. */
  className?: string;
};

export function Percent({ value, className = "", ...options }: PercentProps) {
  return (
    <span className={`font-mono ${className}`}>{formatPercent(value, options)}</span>
  );
}
