import type { ReactNode } from "react";

import { Surface } from "./Surface";

/** A settings section: its title, an optional line under it, and an optional
 *  action on the title's right. */
export function SettingsSurface({ title, hint, action, className = "", children }: {
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const gap = hint ? "mb-1" : "mb-5";
  return (
    <Surface className={`p-6 ${className}`}>
      {action ? (
        <div className={`${gap} flex items-center justify-between gap-4`}>
          <h2 className="text-lg font-semibold text-fg">{title}</h2>
          {action}
        </div>
      ) : (
        <h2 className={`${gap} text-lg font-semibold text-fg`}>{title}</h2>
      )}
      {hint && <p className="mb-5 text-xs text-fg-faint">{hint}</p>}
      {children}
    </Surface>
  );
}
