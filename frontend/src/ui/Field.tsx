import type { ReactNode } from "react";

import { FieldError } from "./FieldError";

/** A form field's name above its control. It still names the control for
 *  screen readers, but clicking it does nothing: it is a heading, not a
 *  button. `error`, what's
 *  wrong with what was typed, goes under the control. */
export function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string | null | false;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={htmlFor} onClick={(e) => e.preventDefault()} className="text-fg-faint text-sm">
        {label}
      </label>
      <div className="flex flex-col gap-1.5">
        {children}
        {error && <FieldError>{error}</FieldError>}
      </div>
    </div>
  );
}
