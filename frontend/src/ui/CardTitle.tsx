import type { ReactNode } from "react";

import { PrivacyEye } from "./MaskedMoney";
import type { Privacy } from "../auth/usePrivacy";

export function CardTitle({
  privacy,
  size = "sm",
  className = "",
  children,
}: {
  privacy?: Privacy | false | null;
  size?: "sm" | "lg";
  className?: string;
  children: ReactNode;
}) {
  return (
    <h2 className={`font-semibold text-fg ${size === "lg" ? "text-lg" : "text-sm"} ${className}`}>
      {children}
      {privacy && privacy.enabled && (
        <span className="ml-3 inline-flex align-middle">
          <PrivacyEye masked={privacy.masked} toggle={privacy.toggle} />
        </span>
      )}
    </h2>
  );
}
