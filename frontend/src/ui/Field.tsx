import type { ReactNode } from "react";

import { FieldError } from "./FieldError";

/** A form field's name above its control (`htmlFor` is the control's id), and
 *  what's wrong with what was typed under it, outside the label so it isn't
 *  read as part of the field's name. The name still names the control for
 *  screen readers, but clicking it does nothing: it is a heading, not a
 *  button. */
export function Field({
  label,
  htmlFor,
  error,
  labelClassName = "text-fg-faint",
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string | null | false;
  labelClassName?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={htmlFor} onClick={(e) => e.preventDefault()} className={`text-sm ${labelClassName}`}>
        {label}
      </label>
      <div className="flex flex-col gap-1.5">
        {children}
        {error && <FieldError>{error}</FieldError>}
      </div>
    </div>
  );
}
