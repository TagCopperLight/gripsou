import type { InputHTMLAttributes } from "react";

/** The app's text field: a filled box, green ring on focus (red when `danger`),
 *  and a red ring that stays while `invalid` (what was typed was refused).
 *  As tall as a `Select`, so the two line up in a form. The ring is drawn
 *  inside the box: outside it, the box's own rounded edge showed through it
 *  at the corners. */
export function TextInput({
  className = "",
  danger = false,
  invalid = false,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { danger?: boolean; invalid?: boolean }) {
  const ring = invalid ? "ring-1 ring-red" : danger ? "focus:ring-1 focus:ring-red" : "focus:ring-1 focus:ring-green";
  return (
    <input
      {...props}
      aria-invalid={invalid || undefined}
      className={`h-9.5 w-full rounded-xl bg-surface-2 px-3.5 py-2.25 text-sm text-fg outline-none ring-inset ${ring} ${className}`}
    />
  );
}
