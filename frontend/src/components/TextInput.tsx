import type { InputHTMLAttributes } from "react";

/** The app's text field: a filled box, green ring on focus. */
export function TextInput({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`h-10.25 w-full rounded-xl bg-surface-2 px-4 py-3 text-[15px] text-fg outline-none focus:ring-1 focus:ring-green ${className}`}
    />
  );
}
