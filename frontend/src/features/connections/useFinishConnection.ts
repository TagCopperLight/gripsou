import { useEffect, useRef, useState } from "react";
import { useCompleteConnection } from "../../api/connections";
import { parseCallbackParams } from "../../lib/connectionCallback";

export type FinishStatus = "idle" | "connecting" | "done" | "failed";

/** Finishes the connection the provider sent the user back from, once per
 *  mount. `query` is the query string it redirected with, read on the first
 *  render only (the caller may clear it from the URL); undefined when there is
 *  nothing to finish. A callback without our `state` fails at once. */
export function useFinishConnection(query: string | undefined, onDone?: () => void) {
  const complete = useCompleteConnection();
  const [callback] = useState(() => (query === undefined ? null : parseCallbackParams(query)));
  const [status, setStatus] = useState<FinishStatus>(
    callback === null ? "idle" : callback.connectionId ? "connecting" : "failed",
  );
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !callback?.connectionId) return;
    started.current = true;
    // Sent even when the provider reported an error: a failed complete deletes
    // the pending connection server-side.
    complete
      .mutateAsync({ connectionId: callback.connectionId, params: callback.rest })
      .then(() => {
        setStatus("done");
        onDone?.();
      })
      .catch(() => setStatus("failed"));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Powens echoes our `state` plus an `error` param when the user cancels or
  // the flow fails.
  return { status, providerError: !!callback?.rest.error };
}
