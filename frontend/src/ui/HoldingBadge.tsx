import { useState } from "react";
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
  // Brandfetch answers 404 when it has no logo for a brand. Remembering which
  // URL failed, rather than a flag, lets a new logo be tried again.
  const [failed, setFailed] = useState<string | null>(null);
  const shown = url !== failed ? url : null;
  return (
    <span
      className={`shrink-0 flex items-center justify-center overflow-hidden font-mono font-semibold text-fg ${className}`}
      style={shown ? undefined : { backgroundColor: color ?? colorForString(ticker) }}
    >
      {shown ? (
        <img src={shown} alt="" className="size-full object-cover" onError={() => setFailed(shown)} />
      ) : (
        (fallbackText ?? ticker.slice(0, 2))
      )}
    </span>
  );
}
