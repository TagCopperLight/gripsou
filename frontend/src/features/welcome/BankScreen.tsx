import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { Check, CircleAlert, Landmark, LoaderCircle } from "lucide-react";

import { Button } from "../../ui/Button";
import { AddConnectionModal } from "../connections/AddConnectionModal";
import { ConnectionGuide } from "../connections/ConnectionGuide";
import { useConnections } from "../../api/connections";
import type { SyncConnection, ConnectionStatus } from "../../api/wire";
import { useStartConnection } from "../connections/useStartConnection";
import { useFinishConnection } from "../connections/useFinishConnection";
import { flattenConnections, isPending, isSyncing } from "../../lib/connectionState";
import { BankKeysGate } from "./BankKeysGate";
import { WelcomeFooter, WelcomeSkip } from "./WelcomeFooter";

const route = getRouteApi("/signedIn/welcome");

/** A first bank. The bank's page sends the user back here
 *  (`/welcome?step=bank`), where the connection is finished. `onNext` is
 *  undefined while it isn't known whether a screen follows. */
export function BankScreen({
  keysMissing, last, onBack, onNext, onSetUpKeys,
}: {
  /** An admin whose server has no working bank keys: connecting would fail. */
  keysMissing: boolean;
  /** No screen follows: the button finishes the welcome flow. */
  last: boolean;
  onBack: () => void;
  onNext: (() => void) | undefined;
  onSetUpKeys: () => void;
}) {
  const { t } = useTranslation();
  const search = route.useSearch();
  const navigate = useNavigate();
  const connections = flattenConnections(useConnections().data);
  const flow = useStartConnection({ returnTo: "/welcome?step=bank", errorMessage: t("welcome.bank.connectError") });
  const providers = flow.providers.data;

  // Coming back from the provider with its query string (ConnectionCallback
  // hands it over; an empty one still counts): finish the connection here.
  const callback = useFinishConnection(search.callback);
  const connecting = callback.status === "connecting";
  const [retried, setRetried] = useState(false);
  const bankFailed = callback.status === "failed" && !retried;
  const callbackCleared = useRef(false);
  useEffect(() => {
    if (callbackCleared.current || search.callback === undefined) return;
    callbackCleared.current = true;
    // Drop the query right away so a reload doesn't redo the connection.
    void navigate({ to: "/welcome", search: { step: "bank" }, replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const connectBank = () => {
    setRetried(true);
    flow.start();
  };

  const hasBank = connections.some((c) => !isPending(c.status));
  const connectDisabled = connecting || flow.pending || providers === undefined;
  const next = (
    <Button onClick={onNext} disabled={!onNext || connecting}>
      {t(last ? "welcome.finish" : "common.next")}
    </Button>
  );
  const skip = <WelcomeSkip onClick={onNext} disabled={!onNext || connecting} />;
  const footer = (
    <WelcomeFooter onBack={onBack}>
      {hasBank ? (
        <>
          <Button variant="ghostStrong" padded={false} onClick={connectBank} disabled={connectDisabled}>
            {t("welcome.bank.addAnother")}
          </Button>
          {next}
        </>
      ) : (
        <>
          {skip}
          <Button onClick={connectBank} disabled={connectDisabled}>
            {t(bankFailed ? "welcome.bank.tryAgain" : "welcome.bank.connect")}
          </Button>
        </>
      )}
    </WelcomeFooter>
  );

  return (
    <>
      {!hasBank && <ConnectionGuide providers={providers ?? []} />}
      {connections.length > 0 && (
        <div className="flex flex-col gap-2">
          {connections.map((c) => <BankRow key={c.id} connection={c} />)}
        </div>
      )}
      {bankFailed && (
        <div className="flex items-center gap-2.5 rounded-xl bg-red-soft px-3.5 py-2.5">
          <CircleAlert className="size-4 shrink-0 text-red" />
          <p className="text-sm text-red-light">{t("welcome.bank.failed")}</p>
        </div>
      )}
      {keysMissing ? <BankKeysGate skip={skip} onBack={onBack} onSetUp={onSetUpKeys} /> : footer}
      {flow.pickerOpen && <AddConnectionModal onClose={flow.closePicker} returnTo="/welcome?step=bank" />}
    </>
  );
}

function bankState(status: ConnectionStatus): "ok" | "error" | "syncing" | "connecting" {
  if (isPending(status)) return "connecting";
  if (isSyncing(status)) return "syncing";
  return status === "error" ? "error" : "ok";
}

function BankRow({ connection }: { connection: SyncConnection }) {
  const { t } = useTranslation();
  const state = bankState(connection.status);
  const tone = { ok: "text-green", error: "text-red", syncing: "text-amber", connecting: "text-fg-dim" }[state];
  return (
    <div className="flex items-center gap-3 rounded-xl bg-surface-2 px-3.5 py-2.5">
      <Landmark className="size-4 text-fg-faint" />
      <span className="flex-1 truncate text-sm text-fg">{connection.displayName}</span>
      <span className={`flex items-center gap-1.5 text-xs ${tone}`}>
        {state === "ok" ? (
          <Check className="size-3" />
        ) : state === "connecting" ? (
          <LoaderCircle className="size-3 animate-spin" />
        ) : (
          <span className="size-1.5 rounded-full bg-current" />
        )}
        {t(`welcome.bank.status.${state}`)}
      </span>
    </div>
  );
}
