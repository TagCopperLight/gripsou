import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";

/** What's wrong with what the user typed, right under the field it's about
 *  (which gets a red ring through its `invalid` prop). */
export function FieldError({ children }: { children: string }) {
  return (
    <p role="alert" className="flex items-center gap-1.5 text-xs text-red">
      <CircleAlert className="size-3.5 shrink-0" />
      {children}
    </p>
  );
}

/** A field's name above it, and its error under it. The error sits outside
 *  the label, so it isn't read as part of the field's name. */
export function LabeledField({
  label,
  error,
  labelClassName = "text-fg-faint",
  children,
}: {
  label: string;
  error?: string | null | false;
  labelClassName?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-2">
        <span className={`text-sm ${labelClassName}`}>{label}</span>
        {children}
      </label>
      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}
