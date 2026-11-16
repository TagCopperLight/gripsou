import { useState } from "react";
import { colorForString } from "../lib/palette";
import { logoUrl } from "../lib/logo";

type Props = {
  logo: string | null;
  ticker: string;
  fallbackText?: string;
  color?: string | null;
  className?: string;
};

export function HoldingBadge({ logo, ticker, fallbackText, color, className = "" }: Props) {
  const url = logoUrl(logo);
  // Brandfetch answers 404 for an unknown brand. Remembering the failed URL, not a flag, lets a new logo be tried.
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
