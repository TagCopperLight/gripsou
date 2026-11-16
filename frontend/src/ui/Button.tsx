import type { ComponentPropsWithoutRef } from "react";

type ButtonVariant = "primary" | "outline" | "ghost" | "ghostStrong" | "ghostDanger" | "danger" | "amber";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-green text-black font-semibold transition-opacity duration-140",
  outline: "border border-surface-3 text-fg font-medium transition-colors duration-140 enabled:hover:bg-hover",
  ghost: "text-fg-dim enabled:hover:text-fg font-medium transition-colors duration-140",
  // A variant, not a caller `text-fg`: see the `amber` note.
  ghostStrong: "text-fg font-medium transition-opacity duration-140 enabled:hover:opacity-70",
  ghostDanger: "text-red/80 enabled:hover:text-red font-medium transition-colors duration-140",
  danger: "bg-red text-black font-semibold transition-opacity duration-140",
  // A variant, not caller classes: `ghost` sets its own `text-fg-dim`, and equal-specificity utilities resolve by stylesheet order, so a caller `text-amber` loses.
  amber: "bg-amber/32 text-amber font-medium transition-colors duration-140 enabled:hover:bg-amber/45",
};

// `gap-[inherit]` keeps the caller's icon-to-text gap.
const LABEL = "[grid-area:1/1] inline-flex items-center justify-center gap-[inherit]";
// While busy, labels swap and dimming starts only after `--loading-delay`, so a fast action shows neither.
const BUSY_LABEL_WAIT = "transition-[visibility] duration-0 delay-(--loading-delay)";
const BUSY_DIM_WAIT = "aria-busy:transition-opacity aria-busy:delay-(--loading-delay)";

export type BusyProps =
  | { busy?: undefined; busyLabel?: undefined }
  | { busy: boolean; busyLabel: string };

type ButtonProps = ComponentPropsWithoutRef<"button"> & BusyProps & {
  variant?: ButtonVariant;
  padded?: boolean;
};

export function Button({
  variant = "primary",
  padded = true,
  type = "button",
  className = "",
  busy = false,
  busyLabel,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`${padded ? "px-3.5 py-2.25" : ""} text-sm rounded-xl cursor-pointer ${VARIANTS[variant]} ${BUSY_DIM_WAIT} ${className}`}
      {...props}
    >
      {busyLabel === undefined ? (
        children
      ) : (
        // Both labels share one grid cell, so the button keeps the longer width.
        <span className="inline-grid gap-[inherit]">
          <span className={`${LABEL} ${busy ? `invisible ${BUSY_LABEL_WAIT}` : ""}`}>{children}</span>
          <span className={`${LABEL} ${busy ? BUSY_LABEL_WAIT : "invisible"}`} aria-hidden={!busy}>
            {busyLabel}
          </span>
        </span>
      )}
    </button>
  );
}
