import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";


const SIZE = {
  lg: "text-[20px]",
  md: "text-[14px]",
  sm: "text-[12px]",
};

/** The amber asterisk on a figure some amount is missing from for want of an
 *  exchange rate; its card's `FxFootnote` says why. Hangs past the figure's
 *  right edge, so the figure keeps its place: its parent must be `relative`. */
export function FxAsterisk({ size = "sm" }: { size?: keyof typeof SIZE }) {
  return (
    <span aria-hidden className={`absolute top-0 left-full ml-0.5 font-sans leading-none text-amber ${SIZE[size]}`}>
      *
    </span>
  );
}

/** The line under a card that explains its asterisks. */
export function FxFootnote({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`text-fg-faint text-xs ${className}`}>
      <span className="text-amber">*</span> {children}
    </p>
  );
}

/** The footnote of a total that leaves `count` holdings out. Zero is
 *  "some amounts": the holdings list hasn't loaded, so how many is unknown. */
export function ExcludedNote({ count }: { count: number }) {
  const { t } = useTranslation();
  return <>{count > 0 ? t("fx.excludes", { count }) : t("fx.excludesSome")}</>;
}
