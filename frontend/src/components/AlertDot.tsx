/** A connection's problem, as a dot on its logo's top-right corner (the logo's
 *  wrapper must be `relative`). The ring matches the surface behind it. */
export function AlertDot({ alert, className = "" }: { alert: "error" | "warning" | null; className?: string }) {
  if (!alert) return null;
  return (
    <span
      data-testid={alert === "error" ? "connection-error-dot" : "connection-warning-dot"}
      className={`absolute -top-0.5 -right-0.5 size-2.5 rounded-full ring-2 transition-colors duration-140 ${alert === "error" ? "bg-red" : "bg-amber"} ${className}`}
    />
  );
}
