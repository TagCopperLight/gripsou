import type { ComponentPropsWithoutRef } from "react";

type ButtonVariant = "primary" | "ghost" | "danger";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-green text-black font-semibold transition-opacity duration-140 disabled:opacity-40 disabled:cursor-not-allowed",
  ghost: "text-fg-dim hover:text-fg font-medium transition-colors duration-140",
  danger:
    "bg-red text-black font-semibold transition-opacity duration-140 disabled:opacity-40 disabled:cursor-not-allowed",
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
      className={`${padded ? "px-4 py-2.5" : ""} rounded-xl cursor-pointer ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}
