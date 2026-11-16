import type { ReactNode } from "react";

export function SettingRow({ label, hint, className = "", children }: {
  label: ReactNode;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`flex items-center justify-between gap-6 ${className}`}>
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-fg">{label}</span>
        {hint && <span className="text-xs text-fg-faint">{hint}</span>}
      </div>
      <div className="flex shrink-0">{children}</div>
    </div>
  );
}
