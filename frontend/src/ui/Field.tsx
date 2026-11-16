import type { ReactNode } from "react";

import { FieldError } from "./FieldError";

/** The error sits outside the label so it isn't read as part of the name. Clicking the name does nothing: it is a heading. */
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
