import { CircleAlert } from "lucide-react";

export function FieldError({ children }: { children: string }) {
  return (
    <p role="alert" className="flex items-center gap-1.5 text-xs text-red">
      <CircleAlert className="size-3.5 shrink-0" />
      {children}
    </p>
  );
}
