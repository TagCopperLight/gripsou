import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";


const SIZE = {
  lg: "text-[20px]",
  md: "text-[14px]",
  sm: "text-[12px]",
};

/** Hangs past the figure's right edge so the figure keeps its place: the parent must be `relative`. */
export function FxAsterisk({ size = "sm" }: { size?: keyof typeof SIZE }) {
  return (
    <span aria-hidden className={`absolute top-0 left-full ml-0.5 font-sans leading-none text-amber ${SIZE[size]}`}>
      *
    </span>
  );
}

export function FxFootnote({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`text-fg-faint text-xs ${className}`}>
      <span className="text-amber">*</span> {children}
    </p>
  );
}

/** Zero means the holdings list hasn't loaded, so the count is unknown: "some amounts". */
export function ExcludedFootnote({ count, className = "" }: { count: number; className?: string }) {
  const { t } = useTranslation();
  return <FxFootnote className={className}>{count > 0 ? t("fx.excludes", { count }) : t("fx.excludesSome")}</FxFootnote>;
}
