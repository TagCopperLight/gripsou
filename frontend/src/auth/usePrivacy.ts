import { useState } from "react";

import { useAuth } from "./context";

/** The reveal lasts for this mount only: a reload comes back masked. */
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
