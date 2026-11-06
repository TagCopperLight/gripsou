import { useRef, useState } from "react";
import { isCurrencyRefused, useAuth } from "./context";

export type CurrencyPick = { code: string; state: "fetching" | "refused" } | null;

/** Picking the reporting currency. The server fetches the new currency's rate
 *  before saving it and refuses it when the rate can't be had, so the pick is
 *  shown (`value`) while it waits, and a refusal stays said until the next pick. */
export function useCurrencyChange() {
  const { prefs, updatePrefs } = useAuth();
  const [pick, setPick] = useState<CurrencyPick>(null);
  const latest = useRef<string | null>(null);

  const change = (code: string) => {
    // Only the last pick speaks: an earlier one answering late must not clear it.
    latest.current = code;
    setPick({ code, state: "fetching" });
    updatePrefs({ currency: code }).then(
      () => latest.current === code && setPick(null),
      (err: unknown) =>
        latest.current === code && setPick(isCurrencyRefused(err) ? { code, state: "refused" } : null),
    );
  };

  return {
    value: pick?.state === "fetching" ? pick.code : prefs.currency,
    pick,
    change,
  };
}
