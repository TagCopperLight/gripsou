import type { ReactNode } from "react";

import { PrivacyEye } from "./MaskedMoney";
import type { Privacy } from "../auth/usePrivacy";

/** A card's (or a section's) heading, with the eye of its masked amounts
 *  after it while private mode is on. `privacy` is left out (or false) while
 *  the card has no figures to reveal. */
export function CardTitle({
  privacy,
  size = "sm",
  className = "",
  children,
}: {
  privacy?: Privacy | false | null;
  /** `lg` heads a page section or a page-wide surface. */
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
