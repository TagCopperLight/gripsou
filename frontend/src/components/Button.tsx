import type { ComponentPropsWithoutRef } from "react";

type ButtonVariant = "primary" | "ghost" | "ghostStrong" | "danger" | "amber";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-green text-black font-semibold transition-opacity duration-140 disabled:opacity-40 disabled:cursor-not-allowed",
  ghost: "text-fg-dim hover:text-fg font-medium transition-colors duration-140",
  // Same shape as `ghost` but already at full contrast — for a bare action that
  // is the primary thing to do in its row (see the `amber` note below on why
  // this is a variant and not a caller-supplied `text-fg`).
  ghostStrong: "text-fg font-medium transition-opacity duration-140 hover:opacity-70 disabled:opacity-40 disabled:cursor-not-allowed",
  danger:
    "bg-red text-black font-semibold transition-opacity duration-140 disabled:opacity-40 disabled:cursor-not-allowed",
  // A variant rather than classes passed by the caller: `ghost` sets its own
  // `text-fg-dim`, and utilities of equal specificity resolve by their order in
  // the generated stylesheet, not by the order of the class attribute — so a
  // caller-supplied `text-amber` silently loses to it.
  amber:
    "bg-amber/32 text-amber font-medium transition-colors duration-140 hover:bg-amber/45",
};

type ButtonProps = ComponentPropsWithoutRef<"button"> & {
  variant?: ButtonVariant;
  padded?: boolean;
};

export function Button({
  variant = "primary",
  padded = true,
  type = "button",
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${padded ? "px-3.5 py-2.25" : ""} text-sm rounded-xl cursor-pointer ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}
