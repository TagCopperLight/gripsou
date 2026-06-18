import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Button } from "../components/Button";
import { useCompleteConnection } from "../api/hooks";

function parseCallbackParams(): {
  connectionId: string | null;
  rest: Record<string, string>;
} {
  const allParams = Object.fromEntries(
    new URLSearchParams(window.location.search),
  );
  const { state: connectionId = null, ...rest } = allParams;
  return { connectionId, rest };
}

export function ConnectionCallback() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const complete = useCompleteConnection();
  const { connectionId, rest } = parseCallbackParams();
  const [failed, setFailed] = useState(() => !connectionId);
  const called = useRef(false);

  useEffect(() => {
    if (!connectionId || called.current) return;
    called.current = true;

    complete.mutateAsync({ connectionId, params: rest })
      .then(() => navigate({ to: "/settings/connections" }))
      .catch(() => setFailed(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (failed || complete.isError) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="flex flex-col items-center gap-4 max-w-md text-center">
          <p className="text-lg font-semibold text-fg">
            {t("connections.callbackError")}
          </p>
          <p className="text-sm text-fg-faint">
            {t("connections.callbackErrorBody")}
          </p>
          <Button onClick={() => navigate({ to: "/settings/connections" })}>
            {t("connections.backToConnections")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-fg-faint">{t("common.loading")}</p>
    </div>
  );
}
