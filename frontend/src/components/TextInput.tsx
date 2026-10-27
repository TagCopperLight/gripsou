import type { InputHTMLAttributes } from "react";

/** The app's text field: a filled box, green ring on focus (red when `danger`).
 *  As tall as a `Select`, so the two line up in a form. The ring is drawn
 *  inside the box: outside it, the box's own rounded edge showed through it
 *  at the corners. */
export function TextInput({
  className = "",
  danger = false,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { danger?: boolean }) {
  return (
    <input
      {...props}
      className={`h-9.5 w-full rounded-xl bg-surface-2 px-3.5 py-2.25 text-sm text-fg outline-none focus:ring-1 focus:ring-inset ${danger ? "focus:ring-red" : "focus:ring-green"} ${className}`}
    />
  );
}
