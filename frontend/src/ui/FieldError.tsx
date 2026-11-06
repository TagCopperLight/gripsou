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
