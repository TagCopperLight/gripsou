import { colorForString } from "../lib/palette";

/** A logo value is a real image only when it's an http(s) or root-relative URL;
 * otherwise it's treated as absent (we fall back to a colored initials swatch). */
function isLogoUrl(logo: string | null | undefined): boolean {
  return !!logo && (logo.startsWith("http") || logo.startsWith("/"));
}

type Props = {
  logo: string | null;
  ticker: string;
  /** Size/shape utilities (e.g. `size-8 rounded-lg text-[11px]`). */
  className?: string;
};

/** An instrument's logo, or a deterministic colored swatch with its initials. */
export function HoldingBadge({ logo, ticker, className = "" }: Props) {
  const hasLogo = isLogoUrl(logo);
  return (
    <span
      className={`shrink-0 flex items-center justify-center font-mono font-semibold text-fg bg-cover bg-center ${className}`}
      style={
        hasLogo
          ? { backgroundImage: `url(${logo})` }
          : { backgroundColor: colorForString(ticker) }
      }
    >
      {!hasLogo && ticker.slice(0, 2)}
    </span>
  );
}
