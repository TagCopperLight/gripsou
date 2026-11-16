import { useRef, useState } from "react";
import { isCurrencyRefused, useAuth } from "./context";

export type CurrencyPick = { code: string; state: "fetching" | "refused" } | null;

/** The pick is shown (`value`) while the server fetches its rate, and a refusal stays said until the next pick. */
export function useCurrencyChange() {
  const { prefs, updatePrefs } = useAuth();
  const [pick, setPick] = useState<CurrencyPick>(null);
  const latest = useRef<string | null>(null);

  const change = (code: string) => {
    // An earlier pick answering late must not clear the last one.
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
