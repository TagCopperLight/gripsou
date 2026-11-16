import type { ComponentPropsWithoutRef } from "react";

type ButtonVariant = "primary" | "outline" | "ghost" | "ghostStrong" | "ghostDanger" | "danger" | "amber";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-green text-black font-semibold transition-opacity duration-140",
  // A real button that doesn't shout: for the one action of an empty state,
  // where a green primary would pull more than the message itself.
  outline: "border border-surface-3 text-fg font-medium transition-colors duration-140 enabled:hover:bg-hover",
  ghost: "text-fg-dim enabled:hover:text-fg font-medium transition-colors duration-140",
  // Same shape as `ghost` but already at full contrast — for a bare action that
  // is the primary thing to do in its row (see the `amber` note below on why
  // this is a variant and not a caller-supplied `text-fg`).
  ghostStrong: "text-fg font-medium transition-opacity duration-140 enabled:hover:opacity-70",
  // A destructive action that sits among others in a window's footer and
  // asks again before doing anything, so it needn't shout like `danger`.
  ghostDanger: "text-red/80 enabled:hover:text-red font-medium transition-colors duration-140",
  danger: "bg-red text-black font-semibold transition-opacity duration-140",
  // A variant rather than classes passed by the caller: `ghost` sets its own
  // `text-fg-dim`, and utilities of equal specificity resolve by their order in
  // the generated stylesheet, not by the order of the class attribute — so a
  // caller-supplied `text-amber` silently loses to it.
  amber: "bg-amber/32 text-amber font-medium transition-colors duration-140 enabled:hover:bg-amber/45",
};

// One cell of the busy grid; `gap-[inherit]` keeps the gap the caller set
// between an icon and its text.
const LABEL = "[grid-area:1/1] inline-flex items-center justify-center gap-[inherit]";
// While busy, the labels swap and the button dims only after `--loading-delay`,
// so a fast action shows neither; it is off from the click on all the same.
// Back to idle, both happen at once.
const BUSY_LABEL_WAIT = "transition-[visibility] duration-0 delay-(--loading-delay)";
const BUSY_DIM_WAIT = "aria-busy:transition-opacity aria-busy:delay-(--loading-delay)";

export type BusyProps =
  | { busy?: undefined; busyLabel?: undefined }
  /** While its action runs, the button is off and says so ("Saving…"). */
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
        // Both labels share one grid cell, the idle one hidden while busy, so
        // the button keeps the width of the longer and nothing beside it moves.
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
