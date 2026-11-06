import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CircleAlert, LoaderCircle } from "lucide-react";

import { AuthPage } from "../../ui/AuthPage";
import { Button } from "../../ui/Button";
import { useCompleteConnection } from "../../api/hooks";
import { parseCallbackParams } from "../../lib/connectionCallback";

/** Where the bank provider sends the user back to. Mid-setup the router hands
 *  the visit to the welcome screen instead, which finishes the connection. */
export function ConnectionCallback() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const complete = useCompleteConnection();
  const { connectionId, rest } = parseCallbackParams(window.location.search);
  // Powens echoes our `state` (the connectionId) plus an `error` param when the
  // user cancels or the flow fails.
  const [failed, setFailed] = useState(() => !connectionId || !!rest.error);
  const called = useRef(false);

  useEffect(() => {
    if (called.current) return;
    called.current = true;

    if (!connectionId) return;

    // Sent even when the provider reported an error: a failed complete deletes
    // the pending connection server-side.
    complete
      .mutateAsync({ connectionId, params: rest })
      .then(() => navigate({ to: "/settings/connections" }))
      .catch(() => setFailed(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AuthPage>
      <div className="flex flex-col items-center gap-4 rounded-3xl bg-surface px-6 py-8 text-center">
        {failed ? (
          <>
            <span className="flex size-11 items-center justify-center rounded-full bg-red-soft text-red">
              <CircleAlert className="size-5" />
            </span>
            <p className="text-lg font-semibold text-fg">{t("connectionCallback.errorTitle")}</p>
            <p className="text-sm text-fg-faint">{t("connectionCallback.errorBody")}</p>
            <Button className="mt-1" onClick={() => void navigate({ to: "/settings/connections" })}>
              {t("connectionCallback.backToConnections")}
            </Button>
          </>
        ) : (
          <>
            <LoaderCircle className="size-8 animate-spin text-green" />
            <p className="text-lg font-semibold text-fg">{t("connectionCallback.connecting")}</p>
            <p className="text-sm text-fg-faint">{t("connectionCallback.connectingBody")}</p>
          </>
        )}
      </div>
    </AuthPage>
  );
}
