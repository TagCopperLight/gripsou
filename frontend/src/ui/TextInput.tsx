import type { InputHTMLAttributes } from "react";

const SIZES = {
  /** On a list line, among chips. */
  sm: "rounded-lg px-2.5 py-1",
  /** As tall as a `Select`, so the two line up in a form. */
  md: "h-9.5 w-full rounded-xl px-3.5 py-2.25",
};

/** The app's text field: a filled box, green ring on focus (red when `danger`),
 *  and a red ring that stays while `invalid` (what was typed was refused).
 *  `sunken` is for a field on an already-lighter panel, as for `Select`. The
 *  ring is drawn inside the box: outside it, the box's own rounded edge showed
 *  through it at the corners. */
export function TextInput({
  className = "",
  danger = false,
  invalid = false,
  inputSize = "md",
  tone = "default",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  danger?: boolean;
  invalid?: boolean;
  inputSize?: keyof typeof SIZES;
  tone?: "default" | "sunken";
}) {
  const ring = invalid ? "ring-1 ring-red" : danger ? "focus:ring-1 focus:ring-red" : "focus:ring-1 focus:ring-green";
  return (
    <input
      {...props}
      aria-invalid={invalid || undefined}
      className={`${SIZES[inputSize]} ${tone === "sunken" ? "bg-surface" : "bg-surface-2"} text-sm text-fg outline-none ring-inset disabled:opacity-60 ${ring} ${className}`}
    />
  );
}
