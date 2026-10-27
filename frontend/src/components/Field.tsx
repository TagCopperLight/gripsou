import type { ReactNode } from "react";

/** A form field's name above its control. It still names the control for
 *  screen readers, but clicking it does nothing: it is a heading, not a
 *  button (it used to focus the field and open a dropdown). */
export function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={htmlFor} onClick={(e) => e.preventDefault()} className="text-fg-faint text-sm">
        {label}
      </label>
      {children}
    </div>
  );
}
