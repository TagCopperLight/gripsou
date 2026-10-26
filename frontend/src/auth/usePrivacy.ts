import { useState } from "react";

import { useAuth } from "./context";

/** Private mode for one card: whether its amounts are masked, and the eye's
 *  toggle. Shared by every figure of the card, so one eye reveals them all.
 *  The reveal lasts for this mount only: a reload always comes back masked. */
export function usePrivacy() {
  const { prefs } = useAuth();
  const [revealed, setRevealed] = useState(false);
  return {
    enabled: prefs.privateMode,
    masked: prefs.privateMode && !revealed,
    toggle: () => setRevealed((r) => !r),
  };
}

export type Privacy = ReturnType<typeof usePrivacy>;
