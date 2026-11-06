import { colorForString } from "../lib/palette";
import { logoUrl } from "../lib/logo";

type Props = {
  logo: string | null;
  ticker: string;
  fallbackText?: string;
  /** Override the swatch color (e.g. the owning account's color). Falls back to
   * a deterministic color derived from `ticker` when absent. */
  color?: string | null;
  /** Size/shape utilities (e.g. `size-8 rounded-lg text-[11px]`). */
  className?: string;
};

/** An instrument's logo, or a colored swatch with its initials. */
export function HoldingBadge({ logo, ticker, fallbackText, color, className = "" }: Props) {
  const url = logoUrl(logo);
  return (
    <span
      className={`shrink-0 flex items-center justify-center font-mono font-semibold text-fg bg-cover bg-center ${className}`}
      style={
        url
          ? { backgroundImage: `url(${url})` }
          : { backgroundColor: color ?? colorForString(ticker) }
      }
    >
      {!url && (fallbackText ?? ticker.slice(0, 2))}
    </span>
  );
}
